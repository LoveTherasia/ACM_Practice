# -*- coding: utf-8 -*-
"""
LoRA 微调脚本：把 training/dataset/*.jsonl 变成一个本地出题模型。

针对 8GB 显存（RTX 4060 Laptop）调优的默认配置：
    - 基座 Qwen2.5-Coder-7B-Instruct，4bit 量化（约 4.5GB 权重）
    - LoRA rank 32（rank 64 在 8GB 上会 OOM）
    - 梯度检查点 + batch 1 + 梯度累积 16

用法（在 WSL2 Ubuntu 内，项目目录通过 /mnt/e/ACM_Practice 访问）：
    pip install unsloth
    python training/finetune.py

更大显存的机器可以放宽：
    python training/finetune.py --base Qwen/Qwen2.5-Coder-14B-Instruct --rank 64

产物：
    training/adapter/          LoRA 适配器权重（可加载回基座）
    training/merged/           合并后的完整模型（供 Ollama 导出）

数据格式（training/dataset/*.jsonl，每行一个样本）：
    {"system": "...", "user": "...", "assistant": "..."}

样本来源是本项目流水线验题通过的生成记录，所以模型学的是
「通过了 run-all-tests.ps1 的输出」，而不是模型的任意输出。
"""

import argparse
import glob
import json
import os
import random
import sys

# 国内网络直连 huggingface.co 不通时走镜像站（可在环境变量里覆盖）。
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

# 8GB 显存下 7B 4bit + rank32 LoRA + 梯度检查点，16384 上下文放不下，
# 降到 12288 仍然能容纳一个完整角色输出（题面 + config 或一份 C++）。
MAX_LENGTH = 12288


def load_dataset(dataset_dir: str):
    """Read every JSONL file and build chat-formatted samples."""
    from datasets import Dataset

    rows = []
    files = sorted(glob.glob(os.path.join(dataset_dir, "*.jsonl")))
    if not files:
        print(f"错误：{dataset_dir} 下没有 .jsonl 文件。", file=sys.stderr)
        print("先用云端模型跑几次造题，验题通过后会自动积累样本。", file=sys.stderr)
        sys.exit(1)

    for path in files:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip().lstrip("\ufeff")
                if not line:
                    continue
                row = json.loads(line)
                if not row.get("verified", False):
                    continue  # 只学验题通过的样本
                rows.append(
                    {
                        "system": row["system"],
                        "user": row["user"],
                        "assistant": row["assistant"],
                    }
                )

    random.Random(42).shuffle(rows)
    print(f"载入 {len(rows)} 条已验证样本，来自 {len(files)} 个文件")
    return Dataset.from_list(rows)


def main():
    parser = argparse.ArgumentParser(description="LoRA finetune for problem generation")
    parser.add_argument(
        "--base",
        default="Qwen/Qwen2.5-Coder-7B-Instruct",
        help="基座模型（8GB 显存用 7B；16GB+ 可用 14B）",
    )
    parser.add_argument("--dataset", default="training/dataset", help="数据集目录")
    parser.add_argument("--out-adapter", default="training/adapter", help="LoRA 输出目录")
    parser.add_argument("--out-merged", default="training/merged", help="合并模型输出目录")
    parser.add_argument("--epochs", type=float, default=3.0, help="训练轮数")
    parser.add_argument("--batch", type=int, default=1, help="每步批大小")
    parser.add_argument("--grad-accum", type=int, default=16, help="梯度累积步数")
    parser.add_argument("--lr", type=float, default=2e-4, help="学习率")
    parser.add_argument("--rank", type=int, default=32, help="LoRA 秩（8GB 用 32）")
    parser.add_argument(
        "--no-merge", action="store_true", help="只保存适配器，不合并（省磁盘）"
    )
    args = parser.parse_args()

    from unsloth import FastLanguageModel
    from trl import SFTTrainer, SFTConfig

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base,
        max_seq_length=MAX_LENGTH,
        dtype=None,  # 自动检测（Ada 架构用 bf16）
        load_in_4bit=True,  # 4bit 量化：7B 约 4.5GB，8GB 显存的关键
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=args.rank,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        lora_alpha=args.rank,
        lora_dropout=0.0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )

    dataset = load_dataset(args.dataset)

    def to_chat(row):
        """把样本转成 chat 模板格式。"""
        messages = [
            {"role": "system", "content": row["system"]},
            {"role": "user", "content": row["user"]},
            {"role": "assistant", "content": row["assistant"]},
        ]
        return {
            "text": tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=False
            )
        }

    dataset = dataset.map(to_chat, remove_columns=dataset.column_names)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        args=SFTConfig(
            output_dir=args.out_adapter,
            per_device_train_batch_size=args.batch,
            gradient_accumulation_steps=args.grad_accum,
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            logging_steps=5,
            save_strategy="epoch",
            warmup_ratio=0.05,
            lr_scheduler_type="cosine",
            fp16=not torch_bf16(),
            bf16=torch_bf16(),
            dataset_text_field="text",
            max_seq_length=MAX_LENGTH,
            seed=42,
            report_to="none",
        ),
    )

    trainer.train()
    model.save_pretrained(args.out_adapter)
    tokenizer.save_pretrained(args.out_adapter)
    print(f"LoRA 适配器已保存到 {args.out_adapter}")

    if not args.no_merge:
        model.save_pretrained_merged(
            args.out_merged, tokenizer, save_method="merged_16bit"
        )
        print(f"合并模型已保存到 {args.out_merged}")
        print("下一步：python training/export_ollama.py 把它导入 Ollama")


def torch_bf16() -> bool:
    """检测当前 GPU 是否支持 bf16。"""
    import torch

    return torch.cuda.is_available() and torch.cuda.is_bf16_supported()


if __name__ == "__main__":
    main()
