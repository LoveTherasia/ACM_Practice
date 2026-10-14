import { runPipeline, type PipelineEvent } from "@/lib/llm/orchestrate";
import type { PipelineBrief } from "@/lib/llm/prompts";
import { complete, llmConfigured, workerModel } from "@/lib/llm/provider";
import { ideaSystem } from "@/lib/llm/prompts";
import { CATEGORIES, randomCategory } from "@/lib/problems/categories";
import { difficultySchema } from "@/lib/problems/schema";

/**
 * Batch generation.
 *
 * One problem takes 10-60 minutes of model time, and the corpus needs
 * dozens. The batch scheduler runs N problems with a small concurrency
 * (the LLM APIs rate-limit well before the local machine does), each with
 * its own AI-brainstormed premise, and streams per-problem progress as SSE
 * so the console can show a live dashboard.
 *
 * Concurrency is deliberately conservative (default 2): each pipeline run
 * holds a long-lived SSE connection, compiles in the sandbox, and makes
 * 5+ model calls with large outputs. DeepSeek-style APIs throttle at
 * roughly this level anyway.
 */

export type BatchItemStatus =
  | "pending"
  | "ideating"
  | "generating"
  | "done"
  | "failed";

export type BatchItem = {
  index: number;
  /** Category id, empty = random per item. */
  category: string;
  categoryLabel: string;
  difficulty: string;
  /** Filled after ideation. */
  premise: string;
  title: string;
  status: BatchItemStatus;
  /** The problem id once allocated (e.g. "dp/dp-012"). */
  problemId: string | null;
  /** Final pipeline status when done. */
  runStatus: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type BatchEvent =
  | { type: "item"; item: BatchItem }
  | { type: "log"; index: number; role: string; message: string }
  | { type: "stage"; index: number; role: string; status: string }
  | { type: "done"; summary: { total: number; passed: number; failed: number } }
  | { type: "error"; message: string };

export type BatchOptions = {
  /** How many problems to generate. */
  count: number;
  /** Concurrent pipeline runs. Default 2, max 4. */
  concurrency: number;
  /** Category id, empty = random per item. */
  category: string;
  difficulty: string;
};

const MAX_CONCURRENCY = 4;

/** Parse the model's idea reply into a premise (reuses the idea route's logic). */
function parseIdea(source: string): { title: string; premise: string } {
  const withoutTags = source
    .replace(/```(?:text|markdown)?/gi, "")
    .replace(/(?:^|\n)\s*tags\s*:\s*.*?(?=\n|$)/gi, "")
    .trim();
  const lines = withoutTags.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => line.trim() !== "");
  const rawTitle = titleIndex >= 0 ? (lines[titleIndex] ?? "").trim() : "未命名题目";
  const title = rawTitle
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(?:标题|题目名称)\s*[:：]\s*/i, "")
    .trim();
  const body = lines
    .slice(titleIndex >= 0 ? titleIndex + 1 : 0)
    .join("\n")
    .replace(/^\s*(?:idea\s*说明|思路说明)\s*[:：]?\s*/i, "")
    .trim();
  return { title, premise: body || title };
}

/** Brainstorm one premise for the given category/difficulty. */
async function brainstorm(
  category: string,
  categoryLabel: string,
  difficulty: string,
): Promise<{ title: string; premise: string }> {
  const direction = category
    ? `请围绕「${categoryLabel}」方向出题`
    : "请自由发挥";
  const reply = await complete(
    [
      { role: "system", content: ideaSystem() },
      {
        role: "user",
        content: `${direction}，难度定位为「${difficulty}」。只输出一个 idea。`,
      },
    ],
    { model: workerModel(), maxTokens: 2000 },
  );
  return parseIdea(reply);
}

/**
 * Run the batch. The emit callback receives every event; the caller wires
 * it to an SSE stream.
 */
export async function runBatch(
  options: BatchOptions,
  emit: (event: BatchEvent) => void,
): Promise<void> {
  if (!llmConfigured()) {
    emit({ type: "error", message: "尚未配置模型凭据。" });
    return;
  }

  const count = Math.max(1, Math.min(20, options.count));
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, options.concurrency || 2));
  const difficulty = difficultySchema.parse(options.difficulty || "中档");

  // Pre-assign categories so the dashboard can show the plan up front.
  const items: BatchItem[] = [];
  for (let i = 0; i < count; i += 1) {
    const pick = options.category
      ? CATEGORIES.find((c) => c.id === options.category) ?? randomCategory()
      : randomCategory();
    items.push({
      index: i,
      category: pick.id,
      categoryLabel: pick.label,
      difficulty,
      premise: "",
      title: "",
      status: "pending",
      problemId: null,
      runStatus: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    });
    emit({ type: "item", item: items[i]! });
  }

  let passed = 0;
  let failed = 0;
  let nextIndex = 0;

  const runOne = async (item: BatchItem) => {
    item.status = "ideating";
    item.startedAt = new Date().toISOString();
    emit({ type: "item", item });

    try {
      // Brainstorm a premise.
      const idea = await brainstorm(item.category, item.categoryLabel, item.difficulty);
      item.title = idea.title;
      item.premise = idea.premise;
      item.status = "generating";
      emit({ type: "item", item });

      // Run the full pipeline for this item.
      const brief: PipelineBrief = {
        category: item.category,
        categoryLabel: item.categoryLabel,
        premise: idea.premise,
        difficulty: item.difficulty as PipelineBrief["difficulty"],
        interactive: false,
        timeLimitMs: 2000,
        memoryLimitMb: 1024,
        tags: [],
      };

      const run = await runPipeline(brief, (event: PipelineEvent) => {
        if (event.type === "log") {
          emit({
            type: "log",
            index: item.index,
            role: event.role,
            message: event.message,
          });
        } else if (event.type === "stage") {
          const last = event.run.stages[event.run.stages.length - 1];
          if (last) {
            emit({
              type: "stage",
              index: item.index,
              role: last.role,
              status: last.status,
            });
          }
        }
      });

      item.problemId = run.slug;
      item.runStatus = run.status;
      item.status = run.status === "done" ? "done" : "failed";
      if (run.status === "done") {
        passed += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      item.status = "failed";
      item.error = (error as Error).message;
      failed += 1;
    }
    item.finishedAt = new Date().toISOString();
    emit({ type: "item", item });
  };

  // Worker pool: each worker pulls the next item until the queue is empty.
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) {
        return;
      }
      await runOne(items[i]!);
    }
  });
  await Promise.all(workers);

  emit({ type: "done", summary: { total: count, passed, failed } });
}
