/**
 * OpenCode 规范导出：把 prompts.ts 中的各角色提示词落成 OpenCode/specs/ 下的 md 文件。
 *
 * 规范的单一真相源仍是 src/lib/llm/prompts.ts（编译进流水线），
 * 这个脚本把它导出为快照，供人工查阅与 OpenCode 会话直接引用。
 *
 * 用法：npx tsx scripts/export-opencode-specs.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import {
  architectSystem,
  integratorSystem,
  judgeValidatorSystem,
  solutionsTutorialSystem,
} from "@/lib/llm/prompts";

const SAMPLE_BRIEF = {
  category: "greedy",
  categoryLabel: "贪心",
  title: "",
  premise: "（示例）区间调度问题",
  difficulty: "中档" as const,
  interactive: false,
  timeLimitMs: 2000,
  memoryLimitMb: 1024,
  tags: [],
};

async function main() {
  const specsDir = path.join(process.cwd(), "OpenCode", "specs");
  await fs.mkdir(specsDir, { recursive: true });

  const files: Record<string, string> = {
    "architect.md": architectSystem(),
    "judge-validator.md": judgeValidatorSystem(SAMPLE_BRIEF),
    "solutions-tutorial.md": solutionsTutorialSystem(SAMPLE_BRIEF),
    "integrator.md": integratorSystem(),
  };

  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(specsDir, name), content, "utf8");
    console.log(`已写出 OpenCode/specs/${name}（${content.length} 字符）`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
