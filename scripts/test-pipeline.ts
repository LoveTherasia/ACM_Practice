/**
 * 端到端链路测试：用当前 .env.local 的 LLM 配置跑一次完整出题流水线。
 *
 * 用法：npx tsx scripts/test-pipeline.ts
 * 需要 .env.local 中 LLM_PROVIDER=opencode（或其他已配置的后端）。
 */
import { loadEnvConfig } from "@next/env";

// tsx 不会像 Next.js 那样自动加载 .env.local，这里手动加载。
loadEnvConfig(process.cwd());

import { runPipeline, type PipelineEvent } from "@/lib/llm/orchestrate";

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

  const started = Date.now();
  const events: string[] = [];

  const run = await runPipeline(brief, (event: PipelineEvent) => {
    if (event.type === "stage") {
      const s = event.run.stages.at(-1);
      console.log(
        `[stage] ${s?.role} -> ${s?.status} ${s?.summary ? "" : ""}`,
      );
      for (const st of event.run.stages) {
        console.log(`    ${st.role}: ${st.status}`);
      }
    } else if (event.type === "log") {
      const line = `[${event.role}] ${event.message}`;
      events.push(line);
      console.log(line);
    } else if (event.type === "done") {
      console.log(`\n[done] runId=${event.run.id} slug=${event.run.slug} status=${event.run.status}`);
    } else if (event.type === "error") {
      console.error(`\n[error] ${event.message}`);
    }
  });

  console.log(`\n=== 总耗时 ${((Date.now() - started) / 1000).toFixed(0)}s ===`);
  console.log(`最终状态: ${run.status}`);
  console.log(`题目目录: problems/${brief.category}/${run.slug}`);
  process.exit(run.status === "done" ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
