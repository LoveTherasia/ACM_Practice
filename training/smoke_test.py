# -*- coding: utf-8 -*-
"""
冒烟测试：用最小配置验证整条训练链路能跑通。

- 基座：Qwen2.5-0.5B（下载约 1GB，1 分钟内装进显存）
- 数据：training/dataset/smoke-test.jsonl（4 条合成样本）
- 训练：2 步，只为验证前向/反向/保存全链路

通过标准：不报错、adapter 目录产出权重文件。
这不是真正的训练——真正的训练用 finetune.py。

用法（WSL2 内）：
    training/.venv/bin/python training/smoke_test.py
"""

import glob
import os
import sys

# 国内网络直连 huggingface.co 不通时走镜像站（可在环境变量里覆盖）。
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

MAX_LENGTH = 2048  # 冒烟样本很短


def main():
    dataset_dir = os.path.join(os.path.dirname(__file__), "dataset")
    files = sorted(glob.glob(os.path.join(dataset_dir, "*.jsonl")))
    if not files:
        print("错误：没有数据文件", file=sys.stderr)
        sys.exit(1)

    import json

    rows = []
    for path in files:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip().lstrip("\ufeff")
                if not line:
                    continue
                row = json.loads(line)
                if row.get("verified", False):
                    rows.append(row)

    print(f"冒烟数据：{len(rows)} 条")

    from unsloth import FastLanguageModel
    from trl import SFTTrainer, SFTConfig
    from datasets import Dataset

    print("加载 Qwen2.5-0.5B（首次下载约 1GB）…")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name="Qwen/Qwen2.5-0.5B-Instruct",
        max_seq_length=MAX_LENGTH,
        dtype=None,
        load_in_4bit=True,
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=8,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_alpha=8,
        lora_dropout=0.0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
    )

    def to_chat(row):
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

    dataset = Dataset.from_list(rows).map(
        to_chat, remove_columns=["system", "user", "assistant"]
    )

    out_dir = os.path.join(os.path.dirname(__file__), ".smoke-adapter")

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        args=SFTConfig(
            output_dir=out_dir,
            per_device_train_batch_size=1,
            gradient_accumulation_steps=1,
            max_steps=2,  # 只跑两步
            learning_rate=2e-4,
            logging_steps=1,
            save_strategy="no",
            dataset_text_field="text",
            max_seq_length=MAX_LENGTH,
            seed=42,
            report_to="none",
        ),
    )

    print("开始训练（2 步）…")
    trainer.train()

    model.save_pretrained(out_dir)
    tokenizer.save_pretrained(out_dir)

    # 验证产物存在
    produced = [
        f for f in os.listdir(out_dir) if f.endswith((".safetensors", ".json"))
    ]
    if not any(f.endswith(".safetensors") for f in produced):
        print("失败：adapter 目录没有权重文件", file=sys.stderr)
        sys.exit(1)

    print()
    print("=" * 50)
    print("冒烟测试通过：训练链路完整可用。")
    print(f"产物目录：{out_dir}")
    print("下一步：积累真实数据后运行 finetune.py")
    print("=" * 50)


if __name__ == "__main__":
    main()
