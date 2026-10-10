# OpenCode 出题工作区

这个文件夹是 OpenCode 后端的**规范与工作目录**。

## 结构

- `specs/` — 各角色的规范文档（md），每次调用 OpenCode 时作为系统提示注入：
  - `architect.md` — 定架构与题面（config.json、statement.md、meta.json）
  - `judge-validator.md` — checker / validator / generator
  - `solutions-tutorial.md` — 两份独立标程与题解
  - `integrator.md` — 整体一致性审查
  - `repair.md` — 验题失败后的修复轮
- `workspaces/` — 每次出题运行的专用工作区（运行时创建，按 runId 命名）。
  OpenCode 在这里直接新建/修改文件，流水线事后收集产物。

## 工作方式

与文件块协议（`<<<FILE ...>>>`）不同，OpenCode 模式下：

1. 流水线在 `workspaces/<runId>/` 下准备好题目骨架（或复制已有工作区）。
2. 调用 `opencode run`，cwd 指向该工作区，规范 md 作为提示注入。
3. OpenCode **直接在工作区里新建、修改文件**。
4. 流水线事后检查产物（编译预检、格式校验、验题），失败则进入修复轮。

规范 md 由 `src/lib/llm/prompts.ts` 中的函数生成（单一真相源），
本文件夹下的文件是导出的快照，供人工查阅与 OpenCode 会话引用。
