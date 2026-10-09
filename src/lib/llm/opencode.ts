import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * OpenCode as a local model backend.
 *
 * OpenCode is a local coding agent, not a completion endpoint, so wiring it in
 * needs care in two places.
 *
 * 1. It must not touch the problem workspace. Its whole value is that it can
 *    read and write files on its own, but the pipeline also writes those files,
 *    and everything that validates them - the compile preflight, the
 *    statement/validator format check, the generator smoke test, the repair
 *    loop - assumes it is the only writer. An agent editing the workspace
 *    behind those checks would defeat them silently. So OpenCode runs inside a
 *    private scratch directory and returns text
 *    via the same `<<<FILE ...>>>` protocol as every other backend. The
 *    pipeline stays the single writer.
 *
 * 2. `run --standalone` starts a private server per invocation and exits, which
 *    costs ~30-45s of startup before any tokens are spent. That is why this is
 *    opt-in rather than a default, and why its timeout is far larger than the
 *    HTTP backends'.
 *
 * Deliberately free of `@/` imports so the backend can be exercised on its own
 * outside Next (which is how it was verified).
 */

/** A failure from the local CLI. Shaped like LlmError without depending on it. */
export class OpenCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenCodeError";
  }
}

/** Where the OpenCode CLI usually lives on Windows (the desktop bundle). */
const WINDOWS_CANDIDATES = [
  process.env.OPENCODE_CLI,
  path.join(
    process.env.LOCALAPPDATA ?? "",
    "Programs",
    "@opencodedesktop",
    "resources",
    "opencode-cli.exe",
  ),
  path.join(process.env.APPDATA ?? "", "ai.opencode.desktop", "cli", "2.0.24", "opencode-cli.exe"),
].filter((value): value is string => Boolean(value));

/** Whether this backend has been asked for. */
export function opencodeEnabled(): boolean {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  return raw === "opencode";
}

/** Resolve the CLI path once, so a missing binary fails clearly and early. */
let cachedCli: string | null = null;

export async function opencodeCli(): Promise<string> {
  if (cachedCli) {
    return cachedCli;
  }

  const explicit = process.env.OPENCODE_CLI?.trim();
  const candidates =
    process.platform === "win32"
      ? WINDOWS_CANDIDATES
      : [explicit, "opencode"].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      cachedCli = candidate;
      return candidate;
    } catch {
      // Try the next location.
    }
  }

  // Last resort on POSIX: let PATH resolve it.
  if (process.platform !== "win32" && explicit === undefined) {
    cachedCli = "opencode";
    return cachedCli;
  }

  throw new OpenCodeError(
    "找不到 OpenCode CLI。请设置 OPENCODE_CLI 指向 opencode-cli.exe，" +
      "或安装 OpenCode Desktop（默认位于 %LOCALAPPDATA%\\Programs\\@opencodedesktop\\resources\\）。",
  );
}

export function opencodeModel(): string {
  return (
    process.env.OPENCODE_MODEL?.trim() ||
    process.env.LLM_MODEL_ARCHITECT?.trim() ||
    "opencode/ling-3.1-flash-free"
  );
}

/**
 * Which OpenCode agent to run as.
 *
 * "build" is OpenCode's normal coding agent; "plan" is its read-only agent.
 * The pipeline needs neither one's tools - it only wants the reply text, and it
 * stays the single writer of the workspace, which the scratch directory
 * guarantees. So the agent choice is a performance knob rather than a safety
 * boundary. Defaults to "build" because "plan" measured markedly slower, but it
 * is overridable for anyone who prefers the read-only agent's stronger
 * guarantee.
 */
export function opencodeAgent(): string {
  return process.env.OPENCODE_AGENT?.trim() || "build";
}

/** One JSONL event from `opencode run --format json`. */
type OpenCodeEvent = {
  type?: string;
  part?: { type?: string; text?: string };
  error?: { type?: string; message?: string; status?: number };
};

/**
 * Fold the JSONL event stream into the assistant's reply.
 *
 * Text arrives as one event per part; step markers and tool events are not
 * reply text and are skipped. An `error` event is authoritative - OpenCode
 * still exits 0 in some failure modes, so the stream is checked rather than the
 * exit code alone.
 */
export function foldOpenCodeEvents(stdout: string): { text: string; error: string | null } {
  const chunks: string[] = [];
  let error: string | null = null;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || !trimmed.startsWith("{")) {
      continue;
    }
    let event: OpenCodeEvent;
    try {
      event = JSON.parse(trimmed) as OpenCodeEvent;
    } catch {
      // A truncated final line is normal when the process is killed.
      continue;
    }
    if (event.type === "error") {
      error = event.error?.message ?? "OpenCode 返回了错误事件";
      continue;
    }
    if (event.type === "text" && typeof event.part?.text === "string") {
      chunks.push(event.part.text);
    }
  }

  return { text: chunks.join(""), error };
}

/**
 * Run one prompt through OpenCode and return its reply text.
 *
 * The prompt goes in over stdin-free argv; OpenCode takes the message as a
 * positional argument. It is passed via a temp file instead when it is very
 * large, because the Windows command line caps out around 32k characters and
 * these prompts are long.
 */
export async function opencodeComplete(
  prompt: string,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  const cli = await opencodeCli();
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "acm-opencode-"));

  try {
    // Long prompts: hand the message over as a file argument. `--file` attaches
    // a file to the message, and the message itself stays short.
    let args: string[];
    const MAX_ARGV = 20000;
    if (prompt.length > MAX_ARGV) {
      const promptFile = path.join(scratch, "prompt.md");
      await fs.writeFile(promptFile, prompt, "utf8");
      args = [
        "run",
        "--standalone",
        "--format",
        "json",
        "--model",
        opencodeModel(),
        "--agent",
        opencodeAgent(),
        "--file",
        promptFile,
        "请严格按上文（附件）中的要求作答，只输出被要求的内容。",
      ];
    } else {
      args = [
        "run",
        "--standalone",
        "--format",
        "json",
        "--model",
        opencodeModel(),
        "--agent",
        opencodeAgent(),
        prompt,
      ];
    }

    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        cli,
        args,
        {
          cwd: scratch,
          timeout: options.timeoutMs,
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, NO_COLOR: "1" },
        },
        (spawnError, out, err) => {
          const killed = Boolean(spawnError && (spawnError as { killed?: boolean }).killed);
          if (killed) {
            reject(
              new OpenCodeError(
                `OpenCode 超时（${options.timeoutMs}ms）。它会为每次调用启动一个私有服务，` +
                  `启动开销约 30-45 秒；如果反复超时，请调大 LLM_TIMEOUT_MS。`,
              ),
            );
            return;
          }
          // A non-zero exit still often carries a usable JSONL stream, so the
          // stream is parsed first and the exit code only decides when the
          // stream has nothing to say.
          const text = String(out);
          if (text.trim() === "") {
            reject(
              new OpenCodeError(
                `OpenCode 没有输出（exit=${
                  spawnError ? ((spawnError as { code?: number }).code ?? 1) : 0
                }）：${String(err).slice(0, 300)}`,
              ),
            );
            return;
          }
          resolve(text);
        },
      );
      options.signal?.addEventListener("abort", () => child.kill(), { once: true });
    });

    const { text, error } = foldOpenCodeEvents(stdout);
    if (error) {
      throw new OpenCodeError(`OpenCode 报错：${error}`);
    }
    if (text.trim() === "") {
      throw new OpenCodeError(
        "OpenCode 没有返回任何文本。常见原因：默认模型已下线（用 OPENCODE_MODEL 指定），" +
          "或凭据失效（在 OpenCode 里重新登录对应 provider）。",
      );
    }
    return text;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}
