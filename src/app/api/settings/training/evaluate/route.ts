import { NextResponse } from "next/server";
import { z } from "zod";

import { llmConfigured, workerModel } from "@/lib/llm/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * POST /api/settings/training/evaluate - score the active model on the corpus.
 *
 * Replays the captured (system, user) prompts against whatever model is
 * currently configured - typically a local fine-tune pointed at Ollama - and
 * reports how many replies followed the file protocol and reproduced the gold
 * file set. This is how a fine-tune is judged beyond "it feels worse".
 *
 * Body (all optional): { limit?: number, role?: string, includePlaceholders?: boolean }
 */
const bodySchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  role: z.string().max(40).optional(),
  includePlaceholders: z.boolean().optional(),
});

export async function POST(request: Request) {
  if (!llmConfigured()) {
    return NextResponse.json(
      { error: "尚未配置模型凭据，无法评估。请到「模型配置」填写 key 或选择本地模型。" },
      { status: 503 },
    );
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body ?? {});
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

  try {
    const { evaluateModel } = await import("@/lib/training/evaluate");
    const report = await evaluateModel({
      ...parsed.data,
      model: workerModel(),
    });
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: `评估失败：${(error as Error).message}` },
      { status: 500 },
    );
  }
}
