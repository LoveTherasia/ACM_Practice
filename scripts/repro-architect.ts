/**
 * 复现流水线的 architect 调用：用与 completeRole 相同的拼接格式生成
 * .task-spec.md，然后手动调用 OpenCode，观察行为差异。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { architectSystem, architectUser } from "@/lib/llm/prompts";
import { opencodeWorkspaceComplete } from "@/lib/llm/opencode";

const FILE_DIRECT_ADDENDUM = `
## 本模式的工作方式（覆盖上面的"输出格式"章节）

你不需要输出 <<<FILE ...>>> 文件块。请直接在当前工作目录里新建和修改文件：

- 先读取当前目录下的 .task-spec.md——那是你的完整任务说明，本消息只是引导。
- 用你的文件工具把每个文件写到磁盘上，路径相对于当前工作目录。
- 工作区里已存在的模板文件（config.json、docs/statement.md 等）必须用你规划的真实内容完整重写。
- 任务说明里列出的每一个文件都必须产出，一个都不能少。
- 文件内容必须完整，禁止 TODO、占位文本、"..."、空实现。
- 只写分配给你的文件，不要动其它角色的文件。
- 完成后只回复一行：DONE
`.trim();

async function main() {
  const brief = {
    category: "greedy",
    categoryLabel: "贪心",
    title: "区间调度",
    premise:
      "有 n 个任务，每个任务有一个开始时间和结束时间。一个机器同一时刻只能执行一个任务，任务一旦开始不能中断。求最多能完成多少个任务。经典活动选择问题，数据范围 n ≤ 2e5。",
    difficulty: "简单" as const,
    interactive: false,
    timeLimitMs: 2000,
    memoryLimitMb: 1024,
    tags: ["greedy", "sorting"],
  };

  // 与 flattenForOpencode 相同的拼接
  const system = `${architectSystem(brief)}\n\n${FILE_DIRECT_ADDENDUM}`;
  const user = architectUser(brief);
  const prompt = `# 系统指令\n\n${system}\n\n---\n\n# 任务\n\n${user}`;

  const ws = path.join(process.cwd(), "OpenCode", "workspaces", "repro-test");
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(ws, { recursive: true });

  console.log(`prompt 长度: ${prompt.length}`);
  console.log(`工作区: ${ws}`);

  const result = await opencodeWorkspaceComplete(prompt, {
    workspaceDir: ws,
    timeoutMs: 600_000,
  });
  console.log(`回复: ${result.reply.slice(0, 200)}`);
  console.log(`写入文件: ${JSON.stringify(result.writtenFiles, null, 2)}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
