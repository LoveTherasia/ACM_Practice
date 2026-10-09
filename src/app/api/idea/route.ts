import { NextResponse } from "next/server";

import { llmConfigured, complete, workerModel } from "@/lib/llm/provider";
import { ideaSystem } from "@/lib/llm/prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/idea - brainstorm a premise to prefill the generator form. */
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

  let topic = "";
  try {
    const body = (await request.json()) as { topic?: unknown };
    if (typeof body.topic === "string") {
      topic = body.topic.slice(0, 200);
    }
  } catch {
    // An empty topic means "surprise me", which is a valid request.
  }

  let reply: string;
  try {
    reply = await complete(
      [
        { role: "system", content: ideaSystem() },
        {
          role: "user",
          content: topic
            ? `请围绕这个方向出题：${topic}`
            : "请自由发挥，给出一个适合区域赛难度的题目 idea。",
        },
      ],
      { model: workerModel(), maxTokens: 2000 },
    );
  } catch (error) {
    // Surface the provider error (timeout, bad key, HTML gateway page)
    // as a readable message instead of an opaque 500.
    return NextResponse.json(
      { error: `模型请求失败：${(error as Error).message}` },
      { status: 502 },
    );
  }

  const tags = /tags:\s*(.+)/i.exec(reply)?.[1]?.trim() ?? "";
  const title = reply.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? "";
  const body = reply.replace(tags, "").trim();

  return NextResponse.json({
    title,
    premise: body,
    tags: tags
      ? tags
          .split(/[,，、]/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 4)
      : [],
  });
}