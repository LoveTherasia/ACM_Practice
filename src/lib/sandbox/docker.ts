import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * The only execution boundary for generated or contestant-controlled code.
 *
 * There is intentionally no native fallback. If Docker or the local image is
 * unavailable, callers fail closed instead of executing an untrusted binary on
 * the host. The container gets no network, no capabilities, no privilege
 * escalation, a read-only root filesystem, bounded processes/resources and
 * only the explicitly supplied mounts.
 */

export const SANDBOX_IMAGE =
  process.env.SANDBOX_IMAGE?.trim() || "acm-practice-sandbox:1";

export type SandboxMount = {
  hostPath: string;
  containerPath: string;
  readOnly?: boolean;
};

export type SandboxResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputLimitExceeded: boolean;
  memoryExceeded: boolean;
};

export type SandboxRunOptions = {
  command: string;
  args?: string[];
  mounts: SandboxMount[];
  workdir?: string;
  input?: Buffer | string;
  timeoutMs: number;
  memoryMb: number;
  cpus?: number;
  pidsLimit?: number;
  maxOutputBytes?: number;
  tmpfsMb?: number;
};

let availability: Promise<void> | null = null;

function dockerExecutable(): string {
  return process.env.DOCKER_CLI?.trim() || "docker";
}

function collect(
  child: ReturnType<typeof spawn>,
  maxBytes: number,
): {
  stdout: () => string;
  stderr: () => string;
  exceeded: () => boolean;
  setLimitHandler: (handler: () => void) => void;
} {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let outputLimitExceeded = false;
  let limitHandler: (() => void) | null = null;

  const append = (target: Buffer[], chunk: Buffer, isStdout: boolean) => {
    const used = isStdout ? stdoutBytes : stderrBytes;
    const remaining = Math.max(0, maxBytes - used);
    if (remaining > 0) {
      target.push(chunk.subarray(0, remaining));
    }
    if (chunk.length > remaining) {
      outputLimitExceeded = true;
      limitHandler?.();
    }
    if (isStdout) stdoutBytes += chunk.length;
    else stderrBytes += chunk.length;
  };

  child.stdout?.on("data", (chunk: Buffer) => append(stdout, chunk, true));
  child.stderr?.on("data", (chunk: Buffer) => append(stderr, chunk, false));

  return {
    stdout: () => Buffer.concat(stdout).toString("utf8"),
    stderr: () => Buffer.concat(stderr).toString("utf8"),
    exceeded: () => outputLimitExceeded,
    setLimitHandler: (handler: () => void) => {
      limitHandler = handler;
    },
  };
}

function runDockerCli(
  args: string[],
  timeoutMs: number,
  input?: Buffer | string,
  maxOutputBytes = 16 * 1024 * 1024,
): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(dockerExecutable(), args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const captured = collect(child, maxOutputBytes);
    let timedOut = false;
    let settled = false;

    captured.setLimitHandler(() => child.kill("SIGKILL"));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout: captured.stdout(),
        stderr: captured.stderr(),
        timedOut,
        outputLimitExceeded: captured.exceeded(),
        memoryExceeded: code === 137,
      });
    });

    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

/** Verify Docker and the prebuilt, local-only sandbox image. */
export async function requireSandbox(): Promise<void> {
  availability ??= (async () => {
    try {
      const result = await runDockerCli(
        ["image", "inspect", SANDBOX_IMAGE],
        15_000,
        undefined,
        512 * 1024,
      );
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || `image ${SANDBOX_IMAGE} not found`);
      }
    } catch (error) {
      availability = null;
      throw new Error(
        "安全沙箱不可用，已拒绝在宿主机执行不可信代码。" +
          `请先启动 Docker，并运行 npm run sandbox:build 构建 ${SANDBOX_IMAGE}。` +
          `原始错误：${(error as Error).message}`,
      );
    }
  })();
  return availability;
}

/** Read-only health check for the settings page and automated tests. */
export async function sandboxStatus(): Promise<{
  available: boolean;
  image: string;
  error: string | null;
}> {
  try {
    await requireSandbox();
    return { available: true, image: SANDBOX_IMAGE, error: null };
  } catch (error) {
    return {
      available: false,
      image: SANDBOX_IMAGE,
      error: (error as Error).message,
    };
  }
}

/**
 * Whether a failure is the sandbox being unavailable rather than a defect in
 * the problem under test.
 *
 * Docker Desktop not running, the daemon unreachable, or our own
 * "安全沙箱不可用" guard all surface as an ordinary non-zero exit from the
 * verifier. Without this they are indistinguishable from a real failure, and the
 * repair loop then spends model calls trying to fix code that was never wrong
 * (observed: graph-009 recorded "[verifier-crash] Docker Desktop is unable to
 * start", which the loop would have treated as a fixable defect). Detecting the
 * infrastructure case lets the pipeline stop instead of burning calls.
 */
const SANDBOX_UNAVAILABLE =
  /Docker Desktop is unable to start|Cannot connect to the Docker daemon|error during connect|Is the docker daemon running|安全沙箱不可用|open \/\/\.\/pipe\/docker|docker_engine|The command '?docker'? could not be found|error getting credentials/i;

export function isSandboxUnavailableError(text: string): boolean {
  return text.trim() !== "" && SANDBOX_UNAVAILABLE.test(text);
}

function validateMount(mount: SandboxMount): void {
  if (!path.isAbsolute(mount.hostPath)) {
    throw new Error(`sandbox mount must be absolute: ${mount.hostPath}`);
  }
  if (!mount.containerPath.startsWith("/") || mount.containerPath.includes(":")) {
    throw new Error(`invalid sandbox container path: ${mount.containerPath}`);
  }
}

/** Run one command in a disposable, locked-down container. */
export async function runSandbox(
  options: SandboxRunOptions,
): Promise<SandboxResult> {
  await requireSandbox();
  for (const mount of options.mounts) validateMount(mount);

  const name = `acm-sandbox-${randomUUID()}`;
  const memoryMb = Math.max(16, Math.floor(options.memoryMb));
  const dockerArgs = [
    "run",
    "--rm",
    // `-i` keeps the container's STDIN open. Without it Docker wires STDIN to
    // /dev/null and every byte written to the docker client's stdin is dropped:
    // the in-sandbox validator, the reference-solution runner and the submit
    // judge all read EOF instead of the input handed to runSandbox().
    "-i",
    "--name",
    name,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    String(options.pidsLimit ?? 64),
    "--memory",
    `${memoryMb}m`,
    "--memory-swap",
    `${memoryMb}m`,
    "--cpus",
    String(options.cpus ?? 1),
    "--ulimit",
    // 64 fd slots crash the .NET runtime inside pwsh (it cannot even load
    // System.Console); 256 is still tight for abuse but roomy enough for
    // PowerShell and g++ to start.
    "nofile=256:256",
    "--ulimit",
    `nproc=${options.pidsLimit ?? 64}:${options.pidsLimit ?? 64}`,
    "--ulimit",
    "core=0:0",
    // 64KB fsize kills g++ the moment it writes an object file (SIGXFSZ,
    // "internal compiler error: File size limit exceeded"). The limit exists
    // to stop unbounded file bombs, not to cap compiler output; 512MB is far
    // above any legitimate artefact and far below filling the disk.
    "--ulimit",
    "fsize=536870912:536870912",
    "--tmpfs",
    `/tmp:rw,noexec,nosuid,nodev,size=${options.tmpfsMb ?? 64}m`,
    "--user",
    "65534:65534",
    "-e",
    "ACM_SANDBOX=1",
    // nobody's home (/nonexistent) does not exist, and PowerShell crashes
    // at startup trying to create its config directory under it when the
    // root filesystem is read-only. Point HOME at the writable tmpfs.
    "-e",
    "HOME=/tmp",
  ];

  for (const mount of options.mounts) {
    // Docker 29 rejects a bare "rw" field in --mount (it wants key=value
    // pairs only); writable is expressed by simply omitting the readonly
    // flag, exactly like the CLI does for `docker run -v`.
    dockerArgs.push(
      "--mount",
      `type=bind,source=${path.resolve(mount.hostPath)},target=${mount.containerPath}${
        mount.readOnly ? ",readonly" : ""
      }`,
    );
  }
  dockerArgs.push(
    "--workdir",
    options.workdir ?? "/work",
    SANDBOX_IMAGE,
    options.command,
    ...(options.args ?? []),
  );

  const result = await runDockerCli(
    dockerArgs,
    options.timeoutMs,
    options.input,
    options.maxOutputBytes,
  );

  // Killing the Docker client on timeout does not reliably kill the container.
  // Force-remove by its unpredictable per-run name; this is safe and idempotent.
  if (result.timedOut || result.outputLimitExceeded) {
    await runDockerCli(["rm", "-f", name], 10_000, undefined, 256 * 1024).catch(
      () => {},
    );
  }
  return result;
}

/** A private writable mount for compiler outputs and transient files. */
export async function withSandboxScratch<T>(
  task: (scratch: string) => Promise<T>,
): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "acm-sandbox-"));
  try {
    // The container intentionally runs as nobody. On POSIX hosts the bind
    // mount therefore needs explicit write permission; on Windows this is a
    // harmless no-op over the translated Docker Desktop mount.
    await fs.chmod(root, 0o777).catch(() => {});
    return await task(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}
