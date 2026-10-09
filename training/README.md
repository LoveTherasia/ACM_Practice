# 本地模型训练指南

把云端模型出题的能力「蒸馏」到一个本地模型上，实现完全离线出题。

## 整体思路

```
云端强模型出题 ──验题通过──▶ training/dataset/*.jsonl ──LoRA 微调──▶ 本地模型
                                                                        │
              ACM Practice ◀── Ollama (OpenAI 兼容端点) ◀──────────────┘
```

核心原则：**只学验题通过的输出**。每条训练样本都是流水线真实发出的
prompt 和通过了 `run-all-tests.ps1` 的回复，所以模型学到的是
「能编译、能卡错解的完整题目工作区」，而不是模型的任意输出。

## 第一步：积累数据（自动进行）

配置好云端模型（控制台 → 模型配置），正常造题。每次验题通过后，
流水线自动把该次运行的全部角色对话追加到 `training/dataset/<slug>.jsonl`。

样本格式（每行一个 JSON）：

```json
{
  "capturedAt": "2026-10-08T...",
  "role": "architect",
  "slug": "shortest-path-tree",
  "difficulty": "中档",
  "verified": true,
  "system": "你是 ICPC 比赛的出题者……",
  "user": "## 出题需求……",
  "assistant": "<<<FILE config.json>>>……<<<END>>>"
}
```

**建议规模**：200+ 条已验证样本（约 40-60 道题）。控制台的
「本地模型训练」面板会实时显示进度。

## 第二步：微调（需要 NVIDIA GPU）

> Unsloth 只支持 Linux / WSL2。Windows 用户请在 WSL2 中执行。
> **硬件要求（按显存）**：
> - 8GB（如 RTX 4060 Laptop）：默认配置，Qwen2.5-Coder-**7B** 4bit + rank 32
> - 16GB：`--base Qwen/Qwen2.5-Coder-14B-Instruct --rank 64`
> - 24GB+：14B/32B 随意

```bash
# WSL2 内，首次先搭环境（安装 Python venv + Unsloth，约 5GB）
bash training/setup_wsl.sh

# 每次训练前激活虚拟环境
source training/.venv/bin/activate

# 冒烟测试（0.5B 模型 2 步，1 分钟验证链路）
python training/smoke_test.py

# 默认配置已按 8GB 显存调优
python training/finetune.py

# 显存更大时换 14B 基座
python training/finetune.py --base Qwen/Qwen2.5-Coder-14B-Instruct --rank 64

# 只保存适配器（省磁盘，之后可再合并）
python training/finetune.py --no-merge
```

**Windows 侧一键入口**（在项目根目录的 PowerShell 里）：

```powershell
.\train.ps1 -Smoke      # 冒烟测试
.\train.ps1             # 正式训练（7B 默认参数）
.\train.ps1 -Epochs 5   # 自定义轮数
```

> 网络说明：脚本默认走 `HF_ENDPOINT=https://hf-mirror.com` 镜像下载模型。
> 如果你能直连 huggingface.co，设置环境变量 `HF_ENDPOINT=https://huggingface.co` 覆盖。

产物：
- `training/adapter/` — LoRA 适配器
- `training/merged/` — 合并后的完整模型

## 第三步：导入 Ollama

```bash
# WSL2 内，需要已安装 Ollama
python training/export_ollama.py --merged training/merged --name acm-problem-gen
ollama serve
```

## 第四步：接入 ACM Practice

控制台 → 模型配置 → **自定义（任意 OpenAI 兼容）**：

| 字段 | 值 |
|---|---|
| Base URL | `http://localhost:11434/v1` |
| API Key | `ollama`（Ollama 不校验，任意非空值） |
| 架构师模型 | `acm-problem-gen` |
| Worker 模型 | `acm-problem-gen` |

保存后重启开发服务器，即可完全本地出题。

## 现实预期

- 14B 级别的微调模型能稳定学会**输出格式**（文件块协议、config 结构、
  题面写法），但 C++ 代码正确率会低于云端强模型——验题失败率会上升。
- 建议的混合策略：本地模型出初稿，验题失败时手动切回云端模型重新生成。
- 数据越多、题目类型越多样，本地模型越可靠。持续积累数据集是关键。

## 目录结构

```
training/
├── README.md            本文档
├── setup_wsl.sh         WSL2 训练环境一键搭建
├── smoke_test.py        冒烟测试（0.5B 模型验证训练链路）
├── dataset/             训练样本（自动积累，可 git 管理）
├── finetune.py          LoRA 微调脚本（Unsloth，默认按 8GB 显存调优）
├── export_ollama.py     导入 Ollama 脚本
├── check_gpu.py         GPU 可见性检查
├── check_unsloth.py     Unsloth 导入检查
├── .venv/               WSL2 内的 Python 虚拟环境（setup_wsl.sh 创建）
├── adapter/             微调产物：LoRA 适配器（训练后生成）
└── merged/              微调产物：合并模型（训练后生成）
```

根目录还有 `train.ps1`：Windows 侧一键训练入口。
