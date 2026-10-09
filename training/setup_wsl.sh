#!/usr/bin/env bash
# -*- coding: utf-8 -*-
#
# WSL2 训练环境一键搭建（Ubuntu 24.04）。
#
# 在 WSL2 Ubuntu 内执行：
#     cd /mnt/e/ACM_Practice
#     bash training/setup_wsl.sh
#
# 做的事情：
#   1. 安装 Python 3.12 + venv
#   2. 创建 training/.venv 虚拟环境
#   3. 安装 Unsloth（自动带上 PyTorch CUDA 版）
#   4. 验证 GPU 可见性
#
# 之后每次训练：
#     source training/.venv/bin/activate
#     python training/finetune.py

set -euo pipefail

echo "=== 1/4 安装系统依赖 ==="
if ! command -v python3 >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y python3 python3-venv python3-pip
fi

echo "=== 2/4 创建虚拟环境 ==="
cd "$(dirname "$0")/.."
if [ ! -d training/.venv ]; then
    python3 -m venv training/.venv
fi
source training/.venv/bin/activate

echo "=== 3/4 安装 Unsloth（首次约 5GB，含 CUDA PyTorch）==="
pip install --upgrade pip
pip install unsloth
# datasets 由 unsloth 依赖带入，显式确认一次
pip install "datasets>=2.16"

echo "=== 4/4 验证 GPU ==="
python - <<'EOF'
import torch
if not torch.cuda.is_available():
    print("警告：PyTorch 看不到 GPU。请确认：")
    print("  1. Windows 侧 nvidia-smi 正常")
    print("  2. WSL2 内运行 nvidia-smi 也正常（驱动透传）")
    print("  3. 本脚本在 WSL2 而不是 Windows Python 里运行")
else:
    name = torch.cuda.get_device_name(0)
    total = torch.cuda.get_device_properties(0).total_memory / 1024**3
    bf16 = torch.cuda.is_bf16_supported()
    print(f"GPU 就绪：{name}，{total:.1f} GB，bf16={bf16}")
EOF

echo ""
echo "环境搭建完成。训练命令："
echo "  source training/.venv/bin/activate"
echo "  python training/finetune.py"
