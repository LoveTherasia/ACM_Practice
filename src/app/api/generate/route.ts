import { NextResponse } from "next/server";
import { z } from "zod";

import { runPipeline, type PipelineEvent } from "@/lib/llm/orchestrate";
import { llmConfigured } from "@/lib/llm/provider";
import { difficultySchema } from "@/lib/problems/schema";
import { randomCategory } from "@/lib/problems/categories";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const briefSchema = z.object({
  /** Empty means "surprise me": a built-in category is picked at random. */
  category: z.string().max(64).default(""),
  categoryLabel: z.string().max(60).optional(),
  title: z.string().max(120).optional(),
  premise: z.string().min(8, "请至少写清楚题目想考什么机制").max(4000),
  difficulty: difficultySchema.default("中档"),
  interactive: z.boolean().default(false),
  timeLimitMs: z.number().int().positive().max(60_000).default(2000),
  memoryLimitMb: z.number().int().positive().max(8192).default(1024),
  tags: z.array(z.string().max(24)).max(8).default([]),
});

/**
 * POST /api/generate
 *
 * Streams the pipeline as server-sent events. The run takes minutes, often
 * longer than a proxy will wait for a buffered JSON response, so progress has to
 * reach the browser incrementally.
 */
export async function POST(request: Request) {
  if (!llmConfigured()) {
    return NextResponse.json(
      {
        error:
          "尚未配置模型凭据。请复制 .env.example 为 .env.local，填入 LLM_API_KEY 后重启开发服务器。",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = briefSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      },
      { status: 400 },
    );
  }

  let brief = parsed.data;

  // Empty category: pick a random built-in category and lean the premise
  // towards it so the problem genuinely belongs to that family.
  if (!brief.category.trim()) {
    const pick = randomCategory();
    brief = {
      ...brief,
      category: pick.id,
      categoryLabel: pick.label,
      premise: `${brief.premise}\n\n（本次随机题型：${pick.label}——${pick.hint}。请围绕这个方向出题。）`,
    };
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: PipelineEvent) => {
        if (closed) {
          return;
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      // If the browser disconnects mid-run, stop paying for model calls.
      const onAbort = () => {
        closed = true;
      };
      request.signal.addEventListener("abort", onAbort, { once: true });

      /**
       * Keep the connection alive while the pipeline is silent.
       *
       * A single architect call can take well over a minute with a reasoning
       * model, and nothing at all is written to the stream in that time. An
       * idle connection is a candidate for being dropped - by a proxy, or by
       * the browser - and when it drops the client loses every later event: the
       * user sees the last frame that arrived ("已创建工作区") and nothing else,
       * even though the run continues and may well finish. Comment frames are
       * ignored by the SSE parser by definition, so they cost nothing.
       */
      const heartbeat = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(": ping\n\n"));
        }
      }, 15_000);

      try {
        await runPipeline(brief, send);
      } catch (error) {
        send({
          type: "error",
          runId: "unknown",
          message: (error as Error).message,
        });
      } finally {
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", onAbort);
        if (!closed) {
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}