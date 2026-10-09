# -*- coding: utf-8 -*-
"""
把微调产物导入 Ollama，让 ACM Practice 直接用本地模型出题。

用法（在 WSL2 / Linux，且已安装 Ollama）：
    python training/export_ollama.py --merged training/merged --name acm-problem-gen

导入后：
    ollama serve                      # 启动 Ollama（默认端口 11434）
    # 然后在 ACM Practice 控制台 → 模型配置 → 自定义：
    #   Base URL: http://localhost:11434/v1
    #   模型名:   acm-problem-gen
    #   API Key:  ollama（Ollama 不校验，任意非空值即可）
"""

import argparse
import os
import sys

TEMPLATE = """FROM .
PARAMETER num_ctx 32768
PARAMETER temperature 0.7
PARAMETER top_p 0.9
"""


def main():
    parser = argparse.ArgumentParser(description="Export merged model to Ollama")
    parser.add_argument("--merged", default="training/merged", help="合并模型目录")
    parser.add_argument("--name", default="acm-problem-gen", help="Ollama 模型名")
    parser.add_argument(
        "--quant", default="q4_k_m", help="量化等级（q4_k_m / q5_k_m / q8_0）"
    )
    args = parser.parse_args()

    if not os.path.isdir(args.merged):
        print(f"错误：{args.merged} 不存在。先运行 finetune.py 生成合并模型。", file=sys.stderr)
        sys.exit(1)

    modelfile = os.path.join(args.merged, "Modelfile")
    with open(modelfile, "w", encoding="utf-8") as handle:
        handle.write(TEMPLATE)

    # ollama create 需要在模型目录内执行，Modelfile 的 FROM . 指向当前目录。
    import subprocess

    result = subprocess.run(
        ["ollama", "create", args.name, "-f", "Modelfile"],
        cwd=args.merged,
        quantize=args.quant,
    )
    if result.returncode != 0:
        print("ollama create 失败。确认已安装 Ollama 并执行过 ollama serve。", file=sys.stderr)
        sys.exit(1)

    print(f"已创建 Ollama 模型：{args.name}")
    print("测试：ollama run " + args.name + " \"你好\"")
    print("接入 ACM Practice：模型配置 → 自定义 → http://localhost:11434/v1")


if __name__ == "__main__":
    main()
