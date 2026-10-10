/**
 * Provider agnostic chat completion.
 *
 * The orchestration layer must not care whether it is talking to OpenAI, an
 * OpenAI-compatible gateway (DeepSeek, Kimi, Qwen, vLLM, OpenRouter) or
 * Anthropic, because which one is cheapest or best for a role changes often.
 * So this module exposes exactly one operation, `complete`, over two wire
 * formats, and keeps credentials in env only.
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  model: string;
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

function requireEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  throw new LlmError(
    `缺少模型凭据：请在 .env.local 中设置 ${keys.join(" 或 ")}，然后重启开发服务器。`,
  );
}

type Provider = "openai" | "anthropic" | "opencode";

function provider(): Provider {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (raw === "anthropic") {
    return "anthropic";
  }
  if (raw === "opencode") {
    return "opencode";
  }
  return "openai";
}

/** Roles that need the strongest reasoning available. */
export function architectModel(): string {
  return (
    process.env.LLM_MODEL_ARCHITECT?.trim() ||
    process.env.LLM_MODEL_WORKER?.trim() ||
    "gpt-4.1"
  );
}

/** Roles where a cheaper, faster model is acceptable. */
export function workerModel(): string {
  return process.env.LLM_MODEL_WORKER?.trim() || architectModel();
}

function maxTokens(): number {
  const raw = Number.parseInt(process.env.LLM_MAX_OUTPUT_TOKENS?.trim() ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 16_000;
}

function timeoutMs(): number {
  const raw = Number.parseInt(process.env.LLM_TIMEOUT_MS?.trim() ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 600_000;
}

function splitSystem(messages: ChatMessage[]): {
  system: string;
  rest: ChatMessage[];
} {
  const system: string[] = [];
  const rest: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      system.push(message.content);
    } else {
      rest.push(message);
    }
  }
  return { system: system.join("\n\n"), rest };
}

/**
 * Fold a chat conversation into the single prompt OpenCode accepts.
 *
 * OpenCode takes one message, so the roles are made explicit as headings rather
 * than dropped: the pipeline's system prompts carry the file-block protocol and
 * the testlib rules, and losing that framing would change the output format.
 */
function flattenForOpencode(messages: ChatMessage[]): string {
  const sections: string[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      sections.push(`# 系统指令\n\n${message.content}`);
    } else if (message.role === "assistant") {
      sections.push(`# 你之前的输出\n\n${message.content}`);
    } else {
      sections.push(`# 任务\n\n${message.content}`);
    }
  }
  return sections.join("\n\n---\n\n");
}

/** Combine the timeout with an externally supplied abort signal. */function linkedSignal(timeout: number, external?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("模型请求超时")), timeout);
  const onAbort = () => controller.abort(external?.reason);
  external?.addEventListener("abort", onAbort, { once: true });
  controller.signal.addEventListener("abort", () => {
    clearTimeout(timer);
    external?.removeEventListener("abort", onAbort);
  });
  return controller.signal;
}

async function readError(response: Response): Promise<LlmError> {
  const body = await response.text().catch(() => "");
  const trimmed = body.slice(0, 800);
  let hint =
    response.status === 401 || response.status === 403
      ? "（API key 无效或没有权限）"
      : response.status === 404
        ? "（模型名或 base URL 不存在）"
        : response.status === 429
          ? "（触发限流）"
          : "";
  // Cloudflare free tunnels hard-cut connections at 100s; problem generation
  // needs far longer per request. Tell the user the real fix.
  if (response.status === 524 || body.includes("trycloudflare.com")) {
    hint =
      "（免费隧道有 100 秒硬超时，造题的长请求必然被掐断。请换官方 API 端点：控制台 → 模型配置 → 智谱 GLM）";
  }
  return new LlmError(
    `模型请求失败 HTTP ${response.status}${hint}: ${trimmed || "(空响应体)"}`,
    response.status,
  );
}

async function completeOpenAi(
  messages: ChatMessage[],
  options: ChatOptions,
  signal: AbortSignal,
): Promise<{ text: string; finishReason: string | null }> {
  const baseUrl = (
    process.env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const apiKey = requireEnv("LLM_API_KEY", "OPENAI_API_KEY");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model: options.model,
      messages,
      max_tokens: options.maxTokens,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw await readError(response);
  }

  // Some gateways answer 200 with an HTML page (login walls, captive
  // portals, misconfigured proxies). Parse defensively so the user sees
  // "endpoint returned HTML" instead of a cryptic JSON syntax error.
  const raw = await response.text();
  let payload: {
    choices?: {
      message?: {
        content?: string | null;
        /** DeepSeek reasoner's chain-of-thought, separate from content. */
        reasoning_content?: string | null;
      };
      finish_reason?: string | null;
    }[];
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    const preview = raw.slice(0, 200).replace(/\s+/g, " ");
    throw new LlmError(
      `端点返回的不是 JSON（可能是 base URL 错误或网关拦截）：${preview}`,
    );
  }
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  const reasoning = choice?.message?.reasoning_content;

  if (typeof content !== "string" || content.trim() === "") {
    // Reasoning models (deepseek-reasoner etc.) burn the token budget on
    // their chain-of-thought; when max_tokens is hit mid-thought, content
    // comes back empty. Diagnose that specifically - the fix is either a
    // bigger budget or a non-reasoning model.
    if (reasoning && reasoning.trim() !== "") {
      throw new LlmError(
        `模型把输出预算耗在了思考链上（reasoning_content 有 ` +
          `${reasoning.length} 字符，但正文为空，finish_reason=${choice?.finish_reason ?? "unknown"}）。` +
          `请把 LLM_MAX_OUTPUT_TOKENS 调大，或改用非推理模型（如 deepseek-chat）。`,
      );
    }
    throw new LlmError(
      `模型返回了空内容（finish_reason=${choice?.finish_reason ?? "unknown"}）。`,
    );
  }
  return { text: content, finishReason: choice?.finish_reason ?? null };
}

async function completeAnthropic(
  messages: ChatMessage[],
  options: ChatOptions,
  signal: AbortSignal,
): Promise<{ text: string; finishReason: string | null }> {
  const baseUrl = (
    process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com/v1"
  ).replace(/\/+$/, "");
  const apiKey = requireEnv("ANTHROPIC_API_KEY");

  const { system, rest } = splitSystem(messages);

  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal,
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens,
      system,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!response.ok) {
    throw await readError(response);
  }

  // Same HTML-page defence as the OpenAI path.
  const raw = await response.text();
  let payload: {
    content?: { type?: string; text?: string }[];
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    const preview = raw.slice(0, 200).replace(/\s+/g, " ");
    throw new LlmError(
      `端点返回的不是 JSON（可能是 base URL 错误或网关拦截）：${preview}`,
    );
  }
  const text = (payload.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("")
    .trim();

  if (text === "") {
    throw new LlmError("模型返回了空内容。");
  }
  return { text, finishReason: null };
}

export type WorkspaceResult = {
  reply: string;
  /** Files the agent created or edited, relative to the workspace, forward slashes. */
  writtenFiles: string[];
  /**
   * Why the agent stopped. "quiet" is the fast path: the workspace stopped
   * changing so the agent was stopped early rather than waiting out its
   * timeout. "deadline" means the timeout was reached; "salvaged" then says
   * whether the files it had already written were kept.
   */
  stopReason?: "exited" | "quiet" | "deadline";
  salvaged?: boolean;
};

/**
 * File-direct completion: the agent works inside `workspaceDir` and writes
 * files there itself. Only meaningful for the OpenCode backend; the HTTP
 * backends have no file access, so they fall back to the text protocol and
 * the caller must parse file blocks from the reply.
 */
export async function completeInWorkspace(
  messages: ChatMessage[],
  workspaceDir: string,
  options?: Partial<ChatOptions>,
): Promise<WorkspaceResult> {
  const kind = provider();
  if (kind !== "opencode") {
    const reply = await complete(messages, options);
    return { reply, writtenFiles: [] };
  }
  const resolved: ChatOptions = {
    model: options?.model ?? workerModel(),
    maxTokens: options?.maxTokens ?? maxTokens(),
    timeoutMs: options?.timeoutMs ?? timeoutMs(),
    signal: options?.signal,
  };
  const { opencodeWorkspaceComplete } = await import("@/lib/llm/opencode");
  return opencodeWorkspaceComplete(flattenForOpencode(messages), {
    workspaceDir,
    timeoutMs: Math.max(resolved.timeoutMs, 600_000),
    signal: resolved.signal,
  });
}

/**
 * One chat completion, transparently continued across max_tokens cuts.
 *
 * Non-streaming per call, but when the model hits the token limit
 * (finish_reason=length) the reply is continued with a "go on" follow-up
 * and the pieces are concatenated. This keeps each individual request
 * short enough for gateways with hard timeouts (free Cloudflare tunnels
 * cut at ~100s) while the caller still receives one complete reply.
 *
 * The continuation prompt is minimal on purpose: the assistant message is
 * replayed verbatim so the model resumes exactly where it stopped.
 */
export async function complete(
  messages: ChatMessage[],
  options?: Partial<ChatOptions>,
): Promise<string> {
  const kind = provider();
  const resolved: ChatOptions = {
    model: options?.model ?? workerModel(),
    maxTokens: options?.maxTokens ?? maxTokens(),
    timeoutMs: options?.timeoutMs ?? timeoutMs(),
    signal: options?.signal,
  };

  // OpenCode replaces the whole completion call rather than one wire format: it
  // is a local agent, so the messages are folded into the single prompt it
  // accepts, and it runs read-only (see lib/llm/opencode.ts).
  if (kind === "opencode") {
    const { opencodeComplete } = await import("@/lib/llm/opencode");
    return opencodeComplete(flattenForOpencode(messages), {
      // Its private server costs ~30-45s of startup per call, so it gets a
      // floor well above the HTTP backends' default.
      timeoutMs: Math.max(resolved.timeoutMs, 600_000),
      signal: resolved.signal,
    });
  }

  const MAX_CONTINUATIONS = 4;
  let conversation = [...messages];
  let full = "";

  for (let piece = 0; piece <= MAX_CONTINUATIONS; piece += 1) {
    const signal = linkedSignal(resolved.timeoutMs, resolved.signal);
    const result =
      kind === "anthropic"
        ? await completeAnthropic(conversation, resolved, signal)
        : await completeOpenAi(conversation, resolved, signal);

    full += result.text;

    if (result.finishReason !== "length") {
      return full;
    }

    // Truncated: ask the model to continue from where it stopped.
    conversation = [
      ...conversation,
      { role: "assistant", content: result.text },
      {
        role: "user",
        content:
          "输出被长度限制截断了。请从你刚才停止的精确位置继续输出，" +
          "不要重复已输出的内容，不要任何解释，直接接着输出。",
      },
    ];
  }

  return full;
}

/** Whether credentials are present, so the UI can show setup guidance. */
export function llmConfigured(): boolean {
  try {
    const kind = provider();
    if (kind === "opencode") {
      // OpenCode holds its own credentials, so there is no key to check here.
      // A missing CLI or an unauthenticated provider surfaces on the first call
      // with a specific message, which is more useful than blocking generation.
      return true;
    }
    if (kind === "anthropic") {
      return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
    }
    return Boolean(
      (process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY)?.trim(),
    );
  } catch {
    return false;
  }
}