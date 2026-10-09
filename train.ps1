# Windows 侧训练入口：从 PowerShell 直接驱动 WSL2 内的训练。
#
# 用法（在 E:\ACM_Practice 下）：
#   .\train.ps1 -Smoke          冒烟测试（0.5B 模型，2 步，验证链路）
#   .\train.ps1                  正式训练（7B，按 8GB 显存调优的默认参数）
#   .\train.ps1 -Epochs 5        自定义轮数
#   .\train.ps1 -Base "Qwen/Qwen2.5-Coder-14B-Instruct" -Rank 64
#
# 训练日志实时输出到控制台，同时保存到 training/.train.log。

param(
    [switch]$Smoke,
    [string]$Base = "Qwen/Qwen2.5-Coder-7B-Instruct",
    [int]$Rank = 32,
    [float]$Epochs = 3.0,
    [int]$Batch = 1,
    [int]$GradAccum = 16
)

$ErrorActionPreference = "Stop"
$env:WSL_UTF8 = 1

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "项目根目录：$repo"
Write-Host "WSL 发行版：Ubuntu-24.04"

# 确认 WSL 和 GPU
wsl -d Ubuntu-24.04 -u root -- bash -c "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "无法在 WSL2 内访问 GPU。请确认已安装 Ubuntu-24.04 且 nvidia-smi 正常。"
    exit 1
}

# 确认虚拟环境存在
wsl -d Ubuntu-24.04 -u root -- bash -c "test -x /mnt/e/ACM_Practice/training/.venv/bin/python"
if ($LASTEXITCODE -ne 0) {
    Write-Host "虚拟环境不存在，先运行 setup_wsl.sh…" -ForegroundColor Yellow
    wsl -d Ubuntu-24.04 -u root -- bash -c "cd /mnt/e/ACM_Practice && bash training/setup_wsl.sh"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "环境搭建失败"
        exit 1
    }
}

$script = if ($Smoke) { "training/smoke_test.py" } else { "training/finetune.py" }
$args = if ($Smoke) {
    ""
} else {
    "--base `"$Base`" --rank $Rank --epochs $Epochs --batch $Batch --grad-accum $GradAccum"
}

Write-Host ""
Write-Host "运行：$script $args" -ForegroundColor Cyan
Write-Host "日志同时保存到 training/.train.log"
Write-Host ""

# tee 到日志文件，同时实时输出
# HF_ENDPOINT 走镜像站，避免国内网络直连 huggingface.co 失败
wsl -d Ubuntu-24.04 -u root -- bash -c "cd /mnt/e/ACM_Practice && HF_ENDPOINT=https://hf-mirror.com training/.venv/bin/python $script $args 2>&1 | tee training/.train.log"
exit $LASTEXITCODE
