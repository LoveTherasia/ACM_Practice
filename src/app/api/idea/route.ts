import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import {
  complete,
  completeInWorkspace,
  llmConfigured,
  workerModel,
} from "@/lib/llm/provider";
import { ideaSystem } from "@/lib/llm/prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Where the idea agent writes its result (relative to the workspace). */
const IDEA_FILE = "idea.md";

/**
 * POST /api/idea - brainstorm a premise to prefill the generator form.
 *
 * In OpenCode (file-direct) mode the agent writes idea.md into a scratch
 * workspace and the route reads it back; in HTTP mode the reply text is
 * parsed as before.
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

  let topic = "";
  try {
    const body = (await request.json()) as { topic?: unknown };
    if (typeof body.topic === "string") {
      topic = body.topic.slice(0, 200);
    }
  } catch {
    // An empty topic means "surprise me", which is a valid request.
  }

  const fileDirect = process.env.LLM_PROVIDER?.trim().toLowerCase() === "opencode";

  let reply: string;
  let ideaText: string | null = null;

  try {
    if (fileDirect) {
      // Scratch workspace under OpenCode/workspaces/; the agent writes
      // idea.md there and the route reads it back.
      const workspaceDir = path.join(
        process.cwd(),
        "OpenCode",
        "workspaces",
        `idea-${Date.now().toString(36)}`,
      );
      await fs.mkdir(workspaceDir, { recursive: true });

      const result = await completeInWorkspace(
        [
          {
            role: "system",
            content: `${ideaSystem()}\n\n## 本模式的工作方式（覆盖上面的"输出格式"章节）\n\n你不需要在回复里输出 idea 内容。请把完整 idea（标题、说明、最后的 tags 行）写入当前目录下的 ${IDEA_FILE} 文件。完成后只回复一行：DONE`,
          },
          {
            role: "user",
            content: topic
              ? `请围绕这个方向出题：${topic}`
              : "请自由发挥，给出一个适合区域赛难度的题目 idea。",
          },
        ],
        workspaceDir,
        { model: workerModel(), maxTokens: 2000 },
      );
      reply = result.reply;

      // Read back what the agent wrote.
      const ideaPath = path.join(workspaceDir, IDEA_FILE);
      try {
        ideaText = await fs.readFile(ideaPath, "utf8");
      } catch {
        // The agent may have replied in text instead of writing the file;
        // fall back to parsing the reply.
        ideaText = null;
      }
      // Clean up the scratch workspace.
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    } else {
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
    }
  } catch (error) {
    // Surface the provider error (timeout, bad key, HTML gateway page)
    // as a readable message instead of an opaque 500.
    return NextResponse.json(
      { error: `模型请求失败：${(error as Error).message}` },
      { status: 502 },
    );
  }

  const source = (ideaText ?? reply).trim();

  // Models are creative about Markdown even though the prompt asks for a
  // simple title + body + tags format. Parse the tags line first, then strip
  // headings and the tags fence so the generated premise never contains its
  // own title or a dangling ``tags:`` block.
  const tagsMatch = /(?:^|\n)\s*`{0,3}\s*tags\s*:\s*(.*?)\s*`{0,3}\s*(?=\n|$)/i.exec(
    source,
  );
  const tags = tagsMatch?.[1]?.trim() ?? "";
  const withoutTags = source
    .replace(/```(?:text|markdown)?/gi, "")
    .replace(/(?:^|\n)\s*tags\s*:\s*.*?(?=\n|$)/gi, "")
    .trim();
  const lines = withoutTags.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => line.trim() !== "");
  const rawTitle =
    titleIndex >= 0 ? (lines[titleIndex] ?? "").trim() : "未命名题目";
  const title = rawTitle
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(?:标题|题目名称)\s*[:：]\s*/i, "")
    .trim();
  const body = lines
    .slice(titleIndex >= 0 ? titleIndex + 1 : 0)
    .join("\n")
    .replace(/^\s*(?:idea\s*说明|思路说明)\s*[:：]?\s*/i, "")
    .trim();

  return NextResponse.json({
    title,
    premise: body || title,
    tags: tags
      ? tags
          .split(/[,，、]/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 4)
      : [],
  });
}
