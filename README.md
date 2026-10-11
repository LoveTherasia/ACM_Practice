# ACM Practice · AI 自主出题流水线

把一个题目 idea 交给多个 LLM 角色协作，自动产出**完整、可本地验证的 ICPC 竞赛题工作区**，并支持把出题能力蒸馏到本地微调模型，实现完全离线出题。

```
用户 idea（Web 控制台）
   │  POST /api/generate（SSE 流式）
   ▼
多角色 LLM 编排
   │  architect → 并行[judge-validator, solutions-tutorial] → integrator → verifier
   ▼
problems/<分类>/<slug>/ 完整题目工作区
   │  run-all-tests.ps1 验题通过
   ▼
training/dataset/*.jsonl（只存验题通过的对话）
   │  Unsloth LoRA 微调（WSL2）
   ▼
Ollama 本地模型 → 回接控制台，实现完全离线出题
```

## 功能特性

- **五阶段出题流水线**：定架构与题面 → judge/validator 与数据 → 标程与题解（两份独立正解）→ 整体一致性审查 → 本地验题（含多轮自动修复）
- **多后端模型支持**：OpenAI 兼容 API / Anthropic / 本地 OpenCode CLI，架构师与 worker 角色可用不同模型
- **OpenCode 文件直写模式**：OpenCode 作为后端时直接在题目工作区里读写文件，各角色规范以 md 文件形式存放在 `OpenCode/specs/`
- **本地验题闭环**：编译预检、数据覆盖审计、testlib 驱动的 generator/validator/checker 全量测试，失败自动进入修复轮
- **训练数据自动积累**：只采集验题通过的完整对话，用于微调本地模型
- **Web 控制台**：出题进度实时流式展示、题目库管理、模型配置、AI 出 idea

## 快速开始

### 环境要求

- Node.js ≥ 20.9
- g++（支持 gnu++20，验题用）
- PowerShell（验题脚本）
- （可选）NVIDIA GPU + WSL2：本地模型微调

### 安装

```bash
npm install
cp .env.example .env.local   # 填入模型凭据
npm run dev                  # http://localhost:3000
```

### 模型配置（.env.local）

```ini
# 三选一：openai / anthropic / opencode
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...

# OpenCode 后端（本地 CLI，无需 API key）
# LLM_PROVIDER=opencode
# OPENCODE_MODEL=opencode/space-bunny-free
# OPENCODE_AGENT=build        # 文件直写模式必须用 build（plan 是只读的）
```

完整配置项见 [.env.example](.env.example)。

### 出一道题

1. 打开控制台 → 出题页
2. 填写核心 idea（或点"让 AI 出个 idea"自动生成）
3. 选择难度、题型分类（留空则随机）、方向标签
4. 提交后实时观察五个阶段的进度，全程约 10–60 分钟（取决于模型）

产物在 `problems/<分类>/<分类>-<编号>/`：

```
greedy-014/
├── config.json              # 本地工作流的唯一真相源（测试点规划等）
├── meta.json                # 难度、标签、格式契约
├── docs/
│   ├── statement.md         # 题面
│   └── tutorial.md          # 题解
├── src/
│   ├── solution.cpp         # 主标程
│   ├── solution2.cpp        # 独立参考解（交叉验证）
│   ├── wrong/*.cpp          # 错解（观察模式）
│   ├── checker/checker.cpp  # checker（交互题为 interactor）
│   ├── validator/validator.cpp
│   └── generator/generator.cpp
└── include/testlib.h
```

## 项目结构

```
├── src/
│   ├── app/                 # Next.js 页面与 API 路由
│   │   ├── console/         # 控制台（出题/题目库/设置）
│   │   └── api/             # generate（SSE）/ idea / problems / settings
│   ├── components/          # UI 组件
│   └── lib/
│       ├── llm/             # 模型编排：provider / prompts / orchestrate / opencode
│       ├── pipeline/        # 流水线阶段定义
│       ├── problems/        # 题目工作区、存储、验题、覆盖审计
│       ├── training/        # 训练样本采集
│       └── settings/        # .env.local 读写
├── skills/
│   └── icpc-problem-creator/  # 出题规范 skill（含验题脚本 run-all-tests.ps1）
├── OpenCode/
│   ├── specs/               # 各角色规范 md（直写模式注入）
│   └── workspaces/          # OpenCode 运行时工作区
├── problems/                # 生成的题目（按分类存放）
├── training/                # 本地模型微调（Unsloth LoRA）
└── verify-logs/             # 验题日志
```

## 本地模型训练

把云端模型的出题能力蒸馏到本地，实现完全离线出题：

```powershell
# 1. 正常造题，验题通过的对话自动积累到 training/dataset/

# 2. WSL2 内搭建环境并微调（默认按 8GB 显存调优）
bash training/setup_wsl.sh
python training/finetune.py

# 3. 导入 Ollama 并回接控制台
python training/export_ollama.py --merged training/merged --name acm-problem-gen
```

详见 [training/README.md](training/README.md)。

## 常用命令

```bash
npm run dev         # 开发服务器
npm run build       # 生产构建
npm run typecheck   # 类型检查
npm run verify      # 手动跑验题脚本
```

## 已知限制

- OpenCode 后端每次调用有 30–45 秒启动开销，整题生成较慢
- 免费模型（如 space-bunny-free）写复杂 C++ 的正确率低于强模型，验题失败率偏高；建议混合策略：本地/免费模型出初稿，失败时切回强模型
- 修复轮最多 4 轮，连续无进展会提前终止

## License

内置的 icpc-problem-creator skill 有自己的 LICENSE（见 skills/icpc-problem-creator/LICENSE）。
