import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";

import { repoRoot } from "@/lib/settings/env-file";
import { complete, llmConfigured, workerModel } from "@/lib/llm/provider";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/llm - the current LLM configuration, with secrets masked.
 *
 * The console needs to show what is configured without ever shipping the key
 * back to the browser. Only a masked preview leaves the server.
 */
export async function GET() {
  const values = await readEnvLocal();
  const provider = values.LLM_PROVIDER?.trim() || "openai";

  const mask = (key: string | undefined): string | null => {
    const raw = key?.trim();
    if (!raw) {
      return null;
    }
    if (raw.length <= 8) {
      return "****";
    }
    return `${raw.slice(0, 4)}****${raw.slice(-4)}`;
  };

  return NextResponse.json({
    configured: llmConfigured(),
    provider,
    baseUrl: values.LLM_BASE_URL?.trim() || null,
    anthropicBaseUrl: values.ANTHROPIC_BASE_URL?.trim() || null,
    apiKeyMasked: mask(values.LLM_API_KEY ?? values.OPENAI_API_KEY),
    anthropicKeyMasked: mask(values.ANTHROPIC_API_KEY),
    modelArchitect: values.LLM_MODEL_ARCHITECT?.trim() || null,
    modelWorker: values.LLM_MODEL_WORKER?.trim() || null,
    maxOutputTokens: values.LLM_MAX_OUTPUT_TOKENS?.trim() || null,
    timeoutMs: values.LLM_TIMEOUT_MS?.trim() || null,
    runVerification: values.RUN_VERIFICATION?.trim() !== "0",
  });
}

const saveSchema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  baseUrl: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
  modelArchitect: z.string().max(200).optional(),
  modelWorker: z.string().max(200).optional(),
  maxOutputTokens: z.string().max(10).optional(),
  timeoutMs: z.string().max(10).optional(),
  runVerification: z.boolean().optional(),
});

/**
 * POST /api/settings/llm - persist the configuration to .env.local.
 *
 * An empty apiKey means "keep the existing one", so the console can save
 * model tweaks without ever round-tripping the secret through the browser.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = saveSchema.safeParse(body);
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

  const input = parsed.data;
  const current = await readEnvLocal();

  const next: Record<string, string> = {};

  if (input.provider === "anthropic") {
    next.LLM_PROVIDER = "anthropic";
    if (input.baseUrl?.trim()) {
      next.ANTHROPIC_BASE_URL = input.baseUrl.trim();
    }
    if (input.apiKey?.trim()) {
      next.ANTHROPIC_API_KEY = input.apiKey.trim();
    }
  } else {
    next.LLM_PROVIDER = "openai";
    if (input.baseUrl?.trim()) {
      next.LLM_BASE_URL = input.baseUrl.trim();
    }
    if (input.apiKey?.trim()) {
      next.LLM_API_KEY = input.apiKey.trim();
    }
  }

  if (input.modelArchitect?.trim()) {
    next.LLM_MODEL_ARCHITECT = input.modelArchitect.trim();
  }
  if (input.modelWorker?.trim()) {
    next.LLM_MODEL_WORKER = input.modelWorker.trim();
  }
  if (input.maxOutputTokens?.trim() && /^\d+$/.test(input.maxOutputTokens.trim())) {
    next.LLM_MAX_OUTPUT_TOKENS = input.maxOutputTokens.trim();
  }
  if (input.timeoutMs?.trim() && /^\d+$/.test(input.timeoutMs.trim())) {
    next.LLM_TIMEOUT_MS = input.timeoutMs.trim();
  }
  if (typeof input.runVerification === "boolean") {
    next.RUN_VERIFICATION = input.runVerification ? "1" : "0";
  }

  if (Object.keys(next).length === 0) {
    return NextResponse.json({ saved: false, note: "没有需要保存的变更" });
  }

  const merged = { ...current, ...next };
  const lines = Object.entries(merged)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`);

  try {
    await fs.writeFile(envLocalPath(), `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    return NextResponse.json(
      { error: `写入 .env.local 失败: ${(error as Error).message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ saved: true, keys: Object.keys(next) });
}

/**
 * PUT /api/settings/llm - test the configuration with one tiny completion.
 *
 * Runs against the saved configuration, so the caller should POST first.
 * A one-token ping keeps the cost effectively zero while proving the
 * credentials, base URL and model name all resolve.
 */
export async function PUT() {
  if (!llmConfigured()) {
    return NextResponse.json(
      { ok: false, error: "尚未配置 API key，请先保存配置。" },
      { status: 400 },
    );
  }
  try {
    const reply = await complete(
      [
        { role: "system", content: "你是连通性测试。只回复：OK" },
        { role: "user", content: "ping" },
      ],
      { model: workerModel(), maxTokens: 64, timeoutMs: 30_000 },
    );
    return NextResponse.json({
      ok: true,
      model: workerModel(),
      reply: reply.slice(0, 100),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 200 },
    );
  }
}

/* -------------------------------------------------------------------------- */

function envLocalPath(): string {
  return path.join(repoRoot, ".env.local");
}

async function readEnvLocal(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const raw = await fs.readFile(envLocalPath(), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) {
        out[match[1] ?? ""] = match[2] ?? "";
      }
    }
  } catch {
    // No .env.local yet is a valid state.
  }
  return out;
}
