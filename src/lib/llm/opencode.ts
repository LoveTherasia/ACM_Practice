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
};/**
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
    // A permission request that reached the stream means --auto did not cover
    // it; without a TTY it would hang until the timeout, so surface it as an
    // error instead.
    if (event.type === "permission" || event.type === "permission-request") {
      error =
        event.part?.text ??
        "OpenCode 在等待权限确认（permission request）。已尝试自动批准失败，请检查 OpenCode 的权限设置。";
      continue;
    }
    if (event.type === "text" && typeof event.part?.text === "string") {
      chunks.push(event.part.text);
    }
  }

  return { text: chunks.join(""), error };
}

/**
 * Run one prompt through OpenCode with direct file access to a workspace.
 *
 * This is the "file-direct" mode: instead of the `<<<FILE ...>>>` text
 * protocol, OpenCode works inside `workspaceDir` and creates/edits files
 * there itself. The pipeline only schedules, then collects the results
 * afterwards (compile preflight, format checks and verification all run
 * after the agent is done, so they stay meaningful).
 *
 * The prompt is written to a file and attached, because these prompts are
 * long (the role specs run to thousands of characters).
 */
export async function opencodeWorkspaceComplete(
  prompt: string,
  options: {
    workspaceDir: string;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<{
  reply: string;
  writtenFiles: string[];
  stopReason: "exited" | "quiet" | "deadline";
  /** True when the deadline was hit but the written files were kept. */
  salvaged: boolean;
}> {
  const cli = await opencodeCli();
  await fs.mkdir(options.workspaceDir, { recursive: true });

  // The full prompt (role spec + task) is written to a file inside the
  // workspace and the message tells the agent to read it first. Passing it
  // via --file did not work: the agent read the attachment but did not act
  // on it. Passing it as the message itself works but hits the ~32k Windows
  // command-line limit for real role specs. The read-then-execute pattern
  // keeps the message short and the spec complete.
  const specFile = ".task-spec.md";
  await fs.writeFile(
    path.join(options.workspaceDir, specFile),
    prompt,
    "utf8",
  );

  const before = await snapshotFiles(options.workspaceDir);

  const args = [
    "run",
    ...(standaloneEnabled() ? ["--standalone"] : []),
    "--auto",
    "--format",
    "json",
    "--model",
    opencodeModel(),
    "--agent",
    opencodeAgent(),
    `先读取当前目录下的 ${specFile}，那是你的完整任务说明（角色规范与本次任务）。` +
      "然后严格按它的要求，直接在当前工作目录里新建和修改文件来完成任务。" +
      "注意：规范里提到的所有文件路径都相对于当前工作目录。" +
      "**只做写文件这一件事**：不要运行编译器、不要运行任何测试或校验命令、" +
      "不要读取任务说明之外的仓库文件、写完后不要再回头检查或改进。" +
      `完成后只回复一行：DONE。不要删除 ${specFile}，不要在回复里输出文件内容。`,
  ];

  /** Filled in by the promise below so the timeout path can salvage work. */
  let timedOut = false;
  let quietExit = false;
  let exitedNonZero: number | null = null;

  const stdout = await new Promise<string>((resolve, reject) => {
    let poll: NodeJS.Timeout | null = null;
    let settled = false;

    /**
     * Stop the agent early.
     *
     * The callback below is the only place that resolves: killing the process
     * causes execFile to invoke it with whatever output was captured, so the
     * JSONL stream is preserved instead of being thrown away. The flags record
     * why we stopped.
     */
    const stop = (reason: "quiet" | "deadline" | "aborted") => {
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      if (reason === "deadline") {
        timedOut = true;
      }
      if (reason === "quiet") {
        quietExit = true;
      }
      killTree(child.pid);
    };

    const child = execFile(
      cli,
      args,
      {
        cwd: options.workspaceDir,
        // No `timeout` here on purpose: execFile's own timeout produces a
        // rejection that discarded work already written to disk. The deadline
        // is enforced by the poll below, where it can become a result.
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: "1" },
      },
      (spawnError, out, err) => {
        if (settled) {
          return;
        }
        settled = true;
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
        if (spawnError) {
          const code = (spawnError as { code?: number }).code;
          exitedNonZero = typeof code === "number" ? code : 1;
        }
        const text = String(out);
        // Empty output with no error and no kill is a real failure; anything
        // else is handed back for the caller to judge against what was written.
        if (text.trim() === "" && !spawnError) {
          reject(
            new OpenCodeError(
              `OpenCode 没有输出（exit=0）：${String(err).slice(0, 300)}`,
            ),
          );
          return;
        }
        resolve(text);
      },
    );
    child.stdin?.end();

    let lastSignature: string | null = null;
    let quietSince = Date.now();
    const startedAt = Date.now();

    poll = setInterval(() => {
      void listFiles(options.workspaceDir).then((files) => {
        if (settled) {
          return;
        }
        const now = Date.now();
        const signature = files.join("|");
        if (lastSignature === null) {
          // First poll: the workspace already contains the spec file, so this
          // signature is the "before" state, not progress. Only start counting
          // quiescence once the signature changes (the first real write).
          lastSignature = signature;
          quietSince = now;
          return;
        }
        if (signature !== lastSignature) {
          lastSignature = signature;
          quietSince = now;
          return;
        }
        const elapsed = now - startedAt;
        // The agent must have written at least one file beyond the spec
        // before quiescence can end the run: a slow-starting agent (long
        // thinking, slow model) is quiet too, and must not be cut off
        // before it writes anything.
        const wroteAnything = files.some((f) => f !== ".task-spec.md");
        if (
          wroteAnything &&
          now - quietSince >= QUIET_GRACE_MS &&
          elapsed > 30_000
        ) {
          stop("quiet");
          return;
        }
        if (elapsed >= options.timeoutMs) {
          stop("deadline");
        }
      });
    }, QUIET_POLL_MS);
    if (typeof poll.unref === "function") {
      poll.unref();
    }

    options.signal?.addEventListener("abort", () => stop("aborted"), { once: true });
  });

  const { text, error } = foldOpenCodeEvents(stdout);
  // An error event is only fatal when nothing was produced: a run that hit its
  // deadline after writing all its files is a success with a caveat.
  if (error && !timedOut) {
    throw new OpenCodeError(`OpenCode 报错：${error}`);
  }

  const after = await snapshotFiles(options.workspaceDir);
  // New files plus files whose content changed; the spec file is an
  // implementation detail and never counts.
  const written = [...after.keys()]
    .filter((f) => f !== specFile)
    .filter((f) => !before.has(f) || before.get(f) !== after.get(f))
    .sort();

  // Keep the spec file out of the collected workspace.
  await fs.rm(path.join(options.workspaceDir, specFile), { force: true }).catch(() => {});

  // A run that produced files has done its job even if the process had to be
  // stopped or never exited cleanly. Reporting this as success is the whole
  // point: the artefacts, not the exit code, are the deliverable.
  if (written.length === 0) {
    if (timedOut) {
      throw new OpenCodeError(
        `OpenCode 超时（${options.timeoutMs}ms）且工作区没有任何变化，无法使用。` +
          `说明这段时间它没有写出文件。可以在 .env.local 调大 LLM_TIMEOUT_MS，` +
          `或改用更快的模型（OPENCODE_MODEL）。`,
      );
    }
    if (error) {
      throw new OpenCodeError(`OpenCode 报错：${error}`);
    }
    if (exitedNonZero !== null) {
      throw new OpenCodeError(
        `OpenCode 退出码 ${exitedNonZero} 且没有写出任何文件：${text.slice(0, 300)}`,
      );
    }
  }

  return {
    reply: text,
    writtenFiles: written,
    /**
     * How the call ended, so the pipeline can say so. "quiet" means the
     * workspace stopped changing and the agent was stopped early - the normal
     * fast path. "deadline" means the timeout was reached but the files were
     * kept. "exited" is the agent finishing on its own.
     */
    stopReason: timedOut ? "deadline" : quietExit ? "quiet" : "exited",
    salvaged: timedOut && written.length > 0,
  };
}

/** Every file under a directory, relative and slash-separated, sorted. */
async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        out.push(path.relative(root, full).replace(/\\/g, "/"));
      }
    }
  }
  await walk(root);
  return out.sort();
}

/** Snapshot every file under a directory: path -> content hash. */
async function snapshotFiles(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const rel = path.relative(root, full).replace(/\\/g, "/");
        try {
          const content = await fs.readFile(full, "utf8");
          out.set(rel, content);
        } catch {
          // Binary or unreadable: record presence only.
          out.set(rel, `<unreadable:${entry.name}>`);
        }
      }
    }
  }
  await walk(root);
  return out;
}

/**
 * How long the workspace must stay unchanged before the agent is considered
 * finished even though its process has not exited.
 *
 * OpenCode's build agent keeps exploring after it has written everything -
 * running builds, re-reading its own output, tidying up - and can stay alive
 * well past the point where the work is done. Measured behaviour: the
 * judge-validator role wrote generator.cpp, checker.cpp, validator.cpp and the
 * wrong solutions and then kept going until a 20-minute timeout killed it, with
 * the written files discarded. Watching the workspace for quiescence turns that
 * into "done, plus a short grace period".
 */
const QUIET_GRACE_MS = Number.parseInt(
  process.env.OPENCODE_QUIET_MS?.trim() || "25000",
  10,
);

/** How often the workspace is checked for changes while the agent runs. */
const QUIET_POLL_MS = 2_000;

/**
 * Whether each call starts its own private OpenCode server.
 *
 * `--standalone` guarantees isolation but pays a full server start per call -
 * measured at roughly 30-45s before any tokens are spent, and there are five
 * calls per problem. Pointing at the existing background service instead
 * removes that cost, at the price of sharing its session state, so it is opt-in
 * via OPENCODE_STANDALONE=0.
 */
function standaloneEnabled(): boolean {
  return process.env.OPENCODE_STANDALONE?.trim() !== "0";
}

/**
 * Kill a process and everything it spawned.
 *
 * The CLI starts a private server as a child; killing only the parent leaves
 * that server alive and holding the workspace, which is how a "finished" run
 * can still be blocked on a later write. taskkill /T walks the tree on Windows,
 * which is the reliable option there.
 */
function killTree(pid: number | undefined): void {
  if (!pid) {
    return;
  }
  try {
    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
      }, () => {});
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // Already gone.
  }
}

/**
 * Run one prompt through OpenCode and return its reply text.
 *
 * The prompt goes in over stdin-free argv; OpenCode takes the message as a
 * positional argument. It is passed via a temp file instead when it is very
 * large, because the Windows command line caps out around 32k characters and
 * these prompts are long.
 *
 * Note: this is the text-protocol mode used for non-file tasks. For problem
 * generation prefer opencodeWorkspaceComplete (file-direct mode).
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
    const MAX_ARGV = 20000;    if (prompt.length > MAX_ARGV) {
      const promptFile = path.join(scratch, "prompt.md");
      await fs.writeFile(promptFile, prompt, "utf8");
      args = [
        "run",
        "--standalone",
        "--auto",
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
        "--auto",
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
      // Close stdin so a permission prompt can never hang the process waiting
      // for interactive input: with stdin closed the CLI either auto-approves
      // (via --auto) or fails fast instead of blocking until the timeout.
      child.stdin?.end();
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
