import { NextResponse } from "next/server";
import { z } from "zod";

import { runBatch, type BatchEvent } from "@/lib/llm/batch";
import { llmConfigured } from "@/lib/llm/provider";
import { difficultySchema } from "@/lib/problems/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const batchSchema = z.object({
  count: z.number().int().min(1).max(20).default(3),
  concurrency: z.number().int().min(1).max(4).default(2),
  category: z.string().max(64).default(""),
  difficulty: difficultySchema.default("中档"),
});

/**
 * POST /api/generate/batch
 *
 * Streams a batch generation as server-sent events. Each item goes through
 * AI ideation then the full pipeline; events carry per-item status, logs
 * and stage transitions so the console can render a live dashboard.
 */
export async function POST(request: Request) {
  if (!llmConfigured()) {
    return NextResponse.json(
      { error: "尚未配置模型凭据。请到「模型配置」填写 API key。" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: BatchEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const onAbort = () => {
        closed = true;
      };
      request.signal.addEventListener("abort", onAbort, { once: true });

      const heartbeat = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(": ping\n\n"));
        }
      }, 15_000);

      try {
        await runBatch(parsed.data, send);
      } catch (error) {
        send({ type: "error", message: (error as Error).message });
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
