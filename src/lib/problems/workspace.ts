import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import { icpcSkillDir, problemDir, problemPath } from "@/lib/paths";
import {
  assertProblemReservation,
  consumeProblemReservation,
} from "@/lib/problems/category";
import { auditCoverage, formatCoverageForLog } from "@/lib/problems/coverage";
import {
  checkDeclaredSamples,
  describeSampleSync,
  syncDeclaredSamples,
} from "@/lib/problems/samples";
import {
  checkConfigParseable,
  checkDeclaredFormat,
  checkInteractiveConfig,
  checkGeneratorTypes,
  checkStatementLanguage,
  checkWrongSolutionSubstance,
  describeFormatMismatch,
} from "@/lib/problems/format";
import { checkTreeData } from "@/lib/problems/tree-check";
import { checkCaseDistinctness } from "@/lib/problems/case-distinctness";
import { checkValidatorAcceptsGenerator } from "@/lib/problems/validator-check";
import {
  problemConfigSchema,
  type ProblemConfig,
  type Verification,
} from "@/lib/problems/schema";
import { runSandbox, withSandboxScratch, isSandboxUnavailableError } from "@/lib/sandbox/docker";

/**
 * Bridge to the vendored PowerShell toolchain.
 *
 * Two scripts matter:
 *   create-workspace.ps1 -Name <slug> [-Interactive]
 *   run-all-tests.ps1 [-Workspace <path>]
 *
 * One wrinkle: create-workspace.ps1 hardcodes its output to
 * <skill-root>/examples/<slug>, because in the upstream repo the examples
 * directory *is* the workspace collection. Here the registry is problems/, so
 * createWorkspace relocates the freshly scaffolded directory afterwards. Passing
 * an absolute path to -Workspace is supported by Resolve-WorkspaceList, so
 * verification works from problems/ without patching the vendored script.
 */

const CREATE_SCRIPT = path.join(icpcSkillDir, "scripts", "create-workspace.ps1");
const VERIFY_SCRIPT =
  process.env.VERIFIER_SCRIPT?.trim() ||
  path.join(icpcSkillDir, "scripts", "run-all-tests.ps1");
/**
 * The skill's own copy of testlib, used to restore a workspace that lost it.
 *
 * This is the canonical source: create-workspace.ps1 copies exactly this file
 * into every new workspace's include/ directory.
 */
const TESTLIB_TEMPLATE = path.join(
  icpcSkillDir,
  "scripts",
  "templates",
  "shared",
  "testlib.h",
);
/** What a healthy testlib.h weighs. Used only to spot an empty placeholder. */
const TESTLIB_MIN_BYTES = 100_000;
// Verification transcripts live at the repo root so they are easy to find:
// <repo>/verify-logs/<problem>-<timestamp>.log. (They used to hide inside
// skills/icpc-problem-creator/.codex-test-artifacts/logs/.)
const LOG_DIR = path.join(process.cwd(), "verify-logs");

const isWindows = process.platform === "win32";

/**
 * Resolve a PowerShell host once per process.
 *
 * pwsh (PowerShell 7) is preferred because it keeps the scripts' Chinese output
 * as UTF-8; Windows PowerShell 5.1 falls back to the machine's active code page
 * and can mangle stage messages. Both run the scripts fine.
 *
 * The verifier scripts need PS7-only features (ConvertFrom-Json -AsHashtable),
 * so 5.1 is NOT an acceptable fallback. The search covers PATH plus the two
 * standard install locations, because a per-user ZIP install (no admin
 * rights needed) never touches PATH.
 */
let cachedHost: string | null = null;

function pwshCandidates(): string[] {
  if (!isWindows) {
    return ["pwsh"];
  }
  const fromPath = ["pwsh.exe"];
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  if (localAppData) {
    fromPath.push(`${localAppData}\\PowerShell\\pwsh.exe`);
    fromPath.push(`${localAppData}\\Microsoft\\WindowsApps\\pwsh.exe`);
  }
  if (programFiles) {
    fromPath.push(`${programFiles}\\PowerShell\\7\\pwsh.exe`);
  }
  return fromPath;
}

async function powershellHost(): Promise<string> {
  if (cachedHost) {
    return cachedHost;
  }
  for (const candidate of pwshCandidates()) {
    const ok = await new Promise<boolean>((resolve) => {
      execFile(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
        timeout: 20_000,
      }, (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        const major = Number.parseInt(String(stdout).trim(), 10);
        resolve(Number.isFinite(major) && major >= 7);
      });
    });
    if (ok) {
      cachedHost = candidate;
      return candidate;
    }
  }
  throw new Error(
    "找不到 PowerShell 7 (pwsh)。请安装 PowerShell 7 后重试，验题脚本依赖它。" +
      "（免安装方式：从 GitHub Releases 下载 win-x64.zip 解压到 " +
      "%LOCALAPPDATA%\\PowerShell 即可，无需管理员权限。）",
  );
}

type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
  output: string;
};

async function runScript(
  script: string,
  args: string[],
  timeoutMs: number,
): Promise<RunResult> {
  const host = await powershellHost();
  return new Promise<RunResult>((resolve, reject) => {
    execFile(
      host,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
      {
        cwd: icpcSkillDir,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, NO_COLOR: "1" },
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? Number((error as { code: number }).code)
            : error
              ? 1
              : 0;
        const out = String(stdout);
        const err = String(stderr);
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error(`无法执行 ${host}: ${(error as Error).message}`));
          return;
        }
        if (error && (error as { killed?: boolean }).killed) {
          reject(new Error(`脚本超时（${timeoutMs}ms）: ${path.basename(script)}`));
          return;
        }
        resolve({ code, stdout: out, stderr: err, output: `${out}\n${err}` });
      },
    );
  });
}

/**
 * Whether a directory is a completed problem from a previous pipeline run.
 *
 * A directory name alone is NOT a problem. The pipeline writes meta.json
 * only at the very end of a successful architect stage, so its presence is
 * the marker of a real, registered problem. Anything else - an empty dir,
 * a bare scaffold from a crashed run, a half-finished generation - is fair
 * game to be reclaimed.
 */
async function isCompletedProblem(target: string): Promise<boolean> {
  try {
    await fs.access(path.join(target, "config.json"));
    await fs.access(path.join(target, "meta.json"));
    return true;
  } catch {
    return false;
  }
}

/** Scaffold a workspace from the skill's standard template. */
export async function createWorkspace(
  problemId: string,
  interactive: boolean,
  reservationId?: string,
): Promise<string> {
  const target = problemDir(problemId);
  if (await isCompletedProblem(target)) {
    throw new Error(
      `题目已存在: ${problemId}（有完整的流水线产物）。如需重新生成，请先删除或重命名该目录。`,
    );
  }

  await fs.mkdir(path.dirname(target), { recursive: true });

  if (reservationId) {
    await assertProblemReservation(problemId, reservationId);
  }

  // Reclaim a leftover directory from a crashed or failed run: it only ever
  // contains scaffold output or partial generations, never anything the
  // user made by hand (hand-made problems carry meta.json via the registry).
  if ((await exists(target)) && !reservationId) {
    await fs.rm(target, { recursive: true, force: true });
  }

  // The upstream script refuses to overwrite its own output directory, so a
  // crashed run may also have left a scaffold behind in examples/.
  const slug = problemId.split("/")[1] ?? problemId;
  const staleScaffold = path.join(icpcSkillDir, "examples", slug);
  if (await exists(staleScaffold)) {
    await fs.rm(staleScaffold, { recursive: true, force: true });
  }

  const args = ["-Name", slug];
  if (interactive) {
    args.push("-Interactive");
  }
  const result = await runScript(CREATE_SCRIPT, args, 120_000);
  if (result.code !== 0) {
    throw new Error(`create-workspace.ps1 失败:\n${result.output.trim()}`);
  }

  // The upstream script writes next to itself; move it into the registry.
  const scaffolded = path.join(icpcSkillDir, "examples", slug);
  if (await exists(scaffolded)) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (reservationId) {
      await fs.cp(scaffolded, target, { recursive: true });
      await fs.rm(scaffolded, { recursive: true, force: true });
      await consumeProblemReservation(problemId);
    } else {
      await moveDirectory(scaffolded, target);
    }
  } else if (!(await exists(target))) {
    throw new Error(`脚手架未在预期位置生成: ${scaffolded}`);
  }

  // The script copies testlib itself, but a moved or partially scaffolded tree
  // must not reach the verifier missing the one file it hard-asserts. This is
  // cheap and idempotent, so it runs on every scaffold rather than trusting the
  // move to have preserved everything.
  await ensureWorkspaceAssets(problemId);

  return target;
}

/**
 * Move a freshly scaffolded directory on Windows.
 *
 * fs.rename is atomic but fails with EPERM when anything still holds a handle
 * inside the tree - antivirus scanning the files the script just wrote,
 * search indexing, or the PowerShell process itself not having fully exited.
 * Copy-then-delete is immune to held handles on the source, and the retry
 * covers the rare case where the final delete is briefly blocked.
 */
async function moveDirectory(source: string, target: string): Promise<void> {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Copy the tree first; reading is almost never blocked.
  await fs.cp(source, target, { recursive: true });

  // Then remove the source, retrying a few times if a handle lingers.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(source, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(500 * (attempt + 1));
    }
  }
  // The workspace is already in place; a leftover copy in examples/ is
  // cosmetic, so warn rather than fail the whole run.
  console.warn(
    `工作区已就位，但清理脚手架残留失败（可手动删除）: ${source}`,
    lastError,
  );
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/*
 * ---------------------------------------------------------------------------
 * Skill-owned workspace assets
 * ---------------------------------------------------------------------------
 * A workspace mixes app-written output (config.json, meta.json, src/*.cpp,
 * docs/*.md) with assets that belong to the vendored skill (include/testlib.h).
 * The skill's own scripts only assert that its assets are present - they never
 * restore them - so a workspace that lost testlib.h fails verification forever
 * with "include/testlib.h 不存在" no matter how often it is re-verified.
 *
 * Observed on three workspaces in the registry (data-struct-002, graph-001,
 * graph-002). The cause was transient, but the failure was permanent, which is
 * the property worth fixing: repair the asset instead of re-reporting it.
 */

/** Whether testlib.h is usable, not merely present. */
async function testlibIsUsable(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target);
    return stat.isFile() && stat.size >= TESTLIB_MIN_BYTES;
  } catch {
    return false;
  }
}

/**
 * Restore the skill-owned assets a workspace needs to be verifiable.
 *
 * Idempotent, and called from both the scaffold path and the verify path: the
 * scaffold guarantees a new workspace starts complete, and the verify path
 * heals a workspace that lost the file later (a manual cleanup, a botched copy,
 * a reclaimed directory). An existing testlib.h is never overwritten, so a
 * problem that legitimately pins its own copy keeps it.
 */
export async function ensureWorkspaceAssets(problemId: string): Promise<string[]> {
  const target = problemPath(problemId, "include/testlib.h");
  if (await testlibIsUsable(target)) {
    return [];
  }

  if (!(await exists(TESTLIB_TEMPLATE))) {
    throw new Error(
      `缺少 testlib 模板（${TESTLIB_TEMPLATE}），无法补齐 ${problemId}/include/testlib.h。` +
        `请确认 skills/icpc-problem-creator/scripts/templates/shared/testlib.h 存在。`,
    );
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(TESTLIB_TEMPLATE, target);
  console.log(`已补齐 ${problemId}/include/testlib.h（来自 skill 模板）`);
  return ["include/testlib.h"];
}

const SUCCESS_LINE = /\[success\]\s+(\S+)\s+passed\s+(\d+)\s+cases?/i;
const FAILURE_LINE = /^-\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)$/;
const REPRO_LINE = /^\s+repro:\s+(.+)$/;
/** The two markers run-all-tests.ps1 prints when it reaches its own end. */
const DONE_SUCCESS = "全部测试通过";
const DONE_FAILURE = "失败的测试用例";
/**
 * A crash rather than a verdict: the PowerShell host reports these when the
 * script dies mid-run (a closed pipe while reading a child's output, an
 * out-of-memory kill, a thrown exception inside the script).
 */
const CRASH_LINE =
  /管道正在被关闭|Insufficient memory|OutOfMemory|Invoke-External:|调用.{0,4}GetResult|Exception|异常/i;

/**
 * Parse the verifier transcript.
 *
 * run-all-tests.ps1 reports progress through Write-Host and only guarantees an
 * exit code, so this stays deliberately tolerant: anything we cannot recognise
 * is preserved in the persisted log rather than guessed at.
 */
export function parseVerification(
  problemId: string,
  output: string,
  code: number,
): Verification {
  const now = new Date().toISOString();
  let passedCases = 0;

  const failures: Verification["failures"] = [];
  let pending: { scope: string; stage: string; message: string } | null = null;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(/\u001b\[[0-9;]*m/g, "").trimEnd();
    const trimmed = line.trim();

    const success = SUCCESS_LINE.exec(trimmed);
    if (success) {
      passedCases += Number.parseInt(success[2] ?? "0", 10);
      continue;
    }

    const failure = FAILURE_LINE.exec(trimmed);
    if (failure) {
      if (pending) {
        failures.push({ scope: pending.scope, message: `[${pending.stage}] ${pending.message}` });
      }
      pending = {
        scope: failure[1] ?? problemId,
        stage: failure[2] ?? "unknown",
        message: failure[3] ?? "",
      };
      continue;
    }

    const repro = REPRO_LINE.exec(trimmed);
    if (repro && pending) {
      pending.message = `${pending.message} (repro: ${repro[1] ?? ""})`;
    }
  }

  if (pending) {
    failures.push({ scope: pending.scope, message: `[${pending.stage}] ${pending.message}` });
  }

  const totalCases = Math.max(passedCases + failures.length, passedCases);

  return {
    ranAt: now,
    passed: code === 0,
    totalCases,
    passedCases,
    logPath: null,
    failures,
    // Set by verifyWorkspace when the failure is an unavailable sandbox, not a
    // problem defect; parseVerification itself can only see a transcript.
    infrastructure: false,
  };
}

/**
 * Whether run-all-tests.ps1 reached its own end.
 *
 * Only ASCII markers are trusted here, because the transcript's Chinese text
 * arrives corrupted: pwsh inherits the OEM code page for its piped stdout, so
 * its UTF-8 bytes get decoded as GBK by execFile and the non-ASCII characters
 * are replaced with U+FFFD (observed: the trailing "全部测试通过" lands in the
 * log as "ȫ������ͨ����" with C8 AB / EF BF BD bytes). Matching on those
 * markers would have reported a crash on every single successful run.
 *
 * The reliable verdict markers survive intact:
 *   success -> "[success] <slug> passed N cases."
 *   failure -> a "- [scope] [stage] message" list, or a crash trace
 *   crash   -> neither, plus a non-zero exit code
 */
function reachedVerdict(output: string): boolean {
  // Written by Write-Stage with an ASCII payload, so it is never mangled.
  if (/\[success\]/i.test(output)) {
    return true;
  }
  // A reported failure is a verdict too: the script reached its summary block.
  if (FAILURE_LINE.test(output)) {
    return true;
  }
  // Best effort for the Chinese markers, in case the encoding is ever fixed.
  return output.includes(DONE_SUCCESS) || output.includes(DONE_FAILURE);
}

/** The last crash-looking line, which is the most useful one to report. */
function firstCrashLine(output: string): string | null {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .filter((line) => CRASH_LINE.test(line));
  const last = lines[lines.length - 1];
  return last ? last.slice(0, 300) : null;
}

/** The first line that names the sandbox being unavailable. */
function sandboxFailureLine(output: string): string | null {
  const line = output
    .split(/\r?\n/)
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .find((l) => isSandboxUnavailableError(l));
  return line ? line.slice(0, 300) : null;
}

/* ---------------------------------------------------------------------------
   Compile preflight
   ---------------------------------------------------------------------------
   The repair loop fixes whatever the failure digest points at, and the digest
   comes from a full verification run. That makes each round able to address
   only the FIRST thing that breaks: a compile error hides the data-format
   errors behind it, so the model fixes the compile error, the next round
   discovers the format errors, and the round after that finds something else.
   Observed on dp-011, which needed four independent fixes (readLong ambiguity,
   a lambda returning int with bare `return;`, and a generator/validator format
   mismatch that failed all 38 cases) and ran out of rounds.

   Compiling first inverts that: every compile error in every file is visible
   at once, so one repair round can fix all of them, and the expensive
   verification run that follows tests behaviour rather than syntax.
   ------------------------------------------------------------------------ */

/** Header the compiler needs, resolved from the workspace itself. */
const PREFLIGHT_HEADER = "testlib.h";

/** Source files worth compiling, relative to the workspace root. */
function preflightTargets(config: ProblemConfig): string[] {
  const targets = [config.validator, config.generator.path];
  const judge = config.interactive ? config.interactor : config.checker;
  if (judge) {
    targets.push(judge);
  }
  for (const solution of config.solutions) {
    // Only C++ is compiled; a Python reference solution is not part of the
    // verification flow and would fail here for unrelated reasons.
    if (solution.language !== "python" && solution.path.endsWith(".cpp")) {
      targets.push(solution.path);
    }
  }
  return [...new Set(targets.filter(Boolean))];
}

/**
 * Run the reference solutions against each other on one small case.
 *
 * Two solutions the pipeline calls "independent and correct" must agree. When
 * they do not, at least one is wrong, and no third artefact is needed to say
 * so - the disagreement is the evidence. Observed on dp-012: solution2 agreed
 * with main on trivial inputs and then produced 32088581144445033 where the
 * answer was 0, failing all 33 cases as "参考解未通过 checker". Reading that
 * code did not reveal it (the AI re-check reported both solutions as correct);
 * running them did.
 *
 * Without this, a broken reference solution is only discovered by a full
 * verification run, and the repair loop then tries to fix the checker - which
 * is not what is wrong.
 */
/**
 * Apply the statement's declared samples to a problem's verifier data.
 *
 * The counterpart to the sync the generation pipeline performs. Re-verification
 * and generation must apply the same sample discipline, otherwise a hand-fixed
 * statement can never be confirmed: the generator's sample data may predate the
 * fix, and run-all-tests.ps1 regenerates inputs from the generator, so a
 * statement-only correction would be silently overwritten.
 *
 * Returns the repair-facing diagnostics for a statement-versus-solution
 * contradiction, or an empty list when the samples agree (or cannot be checked).
 */
export async function checkSamplesAgainstSolutions(
  problemId: string,
): Promise<string[]> {
  const config = await readConfigFile(problemId).catch(() => null);
  if (!config) {
    return [];
  }
  const run = await referenceRunner(problemId, config).catch(() => null);
  if (!run) {
    return [];
  }
  const synced = await syncDeclaredSamples(problemId, config, (_name, input) =>
    run(input),
  ).catch(() => null);
  return synced ? describeSampleSync(synced) : [];
}

/**
 * Compile the main solution once and return a runner for arbitrary inputs.
 *
 * Used to check the statement's declared sample outputs against a real answer.
 * Returns null when the solution cannot be built, so the caller skips the check
 * rather than reporting a mismatch it cannot substantiate.
 */
export async function referenceRunner(
  problemId: string,
  config: ProblemConfig,
): Promise<((input: string) => Promise<string | null>) | null> {
  const main =
    config.solutions.find((entry) => entry.role === "main") ?? config.solutions[0];
  if (!main || main.language === "python" || !main.path.endsWith(".cpp")) {
    return null;
  }

  const source = problemPath(problemId, main.path);
  if (!(await exists(source))) {
    return null;
  }

  return async (input: string) => {
    return withSandboxScratch(async (scratch) => {
      await fs.chmod(scratch, 0o777).catch(() => {});
      const build = await runSandbox({
        command: "g++",
        args: ["-std=gnu++20", "-O2", "-I/problem/include", "/problem/source.cpp", "-o", "/work/main"],
        mounts: [
          { hostPath: scratch, containerPath: "/work" },
          { hostPath: source, containerPath: "/problem/source.cpp", readOnly: true },
          { hostPath: problemPath(problemId, "include"), containerPath: "/problem/include", readOnly: true },
        ],
        timeoutMs: 90_000,
        memoryMb: 1024,
        maxOutputBytes: 4 * 1024 * 1024,
      });
      if (build.code !== 0) return null;
      const run = await runSandbox({
        command: "/work/main",
        mounts: [{ hostPath: scratch, containerPath: "/work" }],
        input,
        timeoutMs: 20_000,
        memoryMb: Math.max(config.memoryLimitMb, 16),
        maxOutputBytes: 16 * 1024 * 1024,
      });
      return run.code === 0 && !run.timedOut ? run.stdout : null;
    });
  };
}

/** A compiled generator, callable as (type, seed) -> stdout. */
export type GeneratorRunner = (
  type: string,
  seed: number,
) => Promise<{ code: number; stdout: string } | null>;

/** A compiled validator, callable with the input on stdin. */
export type ValidatorRunner = (
  input: string,
) => Promise<{ code: number; stderr: string; timedOut: boolean } | null>;

/** Build the generator in `scratch` and bind a runner to it. */
async function bindGenerator(
  scratch: string,
  source: string,
  includeDir: string,
): Promise<GeneratorRunner | null> {
  const build = await runSandbox({
    command: "g++",
    args: ["-std=gnu++20", "-O2", "-I/problem/include", "/problem/generator.cpp", "-o", "/work/generator"],
    mounts: [
      { hostPath: scratch, containerPath: "/work" },
      { hostPath: source, containerPath: "/problem/generator.cpp", readOnly: true },
      { hostPath: includeDir, containerPath: "/problem/include", readOnly: true },
    ],
    timeoutMs: 90_000,
    memoryMb: 1024,
    maxOutputBytes: 4 * 1024 * 1024,
  }).catch(() => null);
  if (!build || build.code !== 0) {
    return null;
  }
  return async (type, seed) => {
    const run = await runSandbox({
      command: "/work/generator",
      args: [type, String(seed)],
      mounts: [{ hostPath: scratch, containerPath: "/work" }],
      timeoutMs: 30_000,
      memoryMb: 512,
      maxOutputBytes: 16 * 1024 * 1024,
    }).catch(() => null);
    return run && run.code === 0 && !run.timedOut ? { code: run.code, stdout: run.stdout } : null;
  };
}

/** Build the validator in `scratch` and bind a stdin runner to it. */
async function bindValidator(
  scratch: string,
  source: string,
  includeDir: string,
): Promise<ValidatorRunner | null> {
  const build = await runSandbox({
    command: "g++",
    args: ["-std=gnu++20", "-O2", "-I/problem/include", "/problem/validator.cpp", "-o", "/work/validator"],
    mounts: [
      { hostPath: scratch, containerPath: "/work" },
      { hostPath: source, containerPath: "/problem/validator.cpp", readOnly: true },
      { hostPath: includeDir, containerPath: "/problem/include", readOnly: true },
    ],
    timeoutMs: 90_000,
    memoryMb: 1024,
    maxOutputBytes: 4 * 1024 * 1024,
  }).catch(() => null);
  if (!build || build.code !== 0) {
    return null;
  }
  return async (input) => {
    const run = await runSandbox({
      command: "/work/validator",
      mounts: [{ hostPath: scratch, containerPath: "/work" }],
      input,
      timeoutMs: 30_000,
      memoryMb: 512,
      maxOutputBytes: 4 * 1024 * 1024,
    }).catch(() => null);
    return run ? { code: run.code, stderr: run.stderr, timedOut: run.timedOut } : null;
  };
}

/**
 * Compile the generator and validator once each, hand both runners to `task`,
 * and keep the scratch alive for the whole task.
 *
 * The scratch MUST outlive the runners: an earlier version returned a runner
 * from inside withSandboxScratch, which deletes the scratch - and the compiled
 * binary with it - the instant the factory resolves. Every later call then
 * exec'd a missing file and returned null, so tree-check and case-distinctness
 * silently probed nothing (`probed = 0`) and always reported success. Passing the
 * runners to a callback ties their lifetime to the scratch correctly.
 */
export async function withSandboxedGeneratorAndValidator<T>(
  problemId: string,
  config: ProblemConfig,
  task: (tools: {
    runGenerator: GeneratorRunner | null;
    runValidator: ValidatorRunner | null;
  }) => Promise<T>,
): Promise<T> {
  return withSandboxScratch(async (scratch) => {
    await fs.chmod(scratch, 0o777).catch(() => {});
    const includeDir = problemPath(problemId, "include");

    const generatorSource = problemPath(problemId, config.generator.path);
    const runGenerator = (await exists(generatorSource))
      ? await bindGenerator(scratch, generatorSource, includeDir)
      : null;

    const validatorSource = problemPath(problemId, config.validator);
    const runValidator =
      config.validator && (await exists(validatorSource))
        ? await bindValidator(scratch, validatorSource, includeDir)
        : null;

    return task({ runGenerator, runValidator });
  });
}

/**
 * Preflight check outcomes: ran and found nothing, ran and found problems, or
 * could not run at all.
 *
 * The "skipped" state is the point. Every check used to be wrapped in
 * `.catch(() => [])`, so a check that silently did nothing was indistinguishable
 * from one that passed - and a broken runner hid both tree-check and
 * case-distinctness for a long time. Callers can now tell "green" from "never
 * looked".
 */
export type PreflightCheckStatus = "passed" | "failed" | "skipped";

export type PreflightCheck = {
  id: string;
  title: string;
  status: PreflightCheckStatus;
  problems: string[];
  /** Why the check could not run (only when status === "skipped"). */
  reason?: string;
};

export type PreflightReport = {
  checks: PreflightCheck[];
  /** Every problem message, flattened (feeds the repair prompt). */
  problems: string[];
  /** Ids of checks that could not run. */
  skipped: string[];
};

/** Compile every source file without producing a binary; short diagnostics. */
async function compileDiagnostics(
  problemId: string,
  config: ProblemConfig,
  includeDir: string,
): Promise<string[]> {
  const problems: string[] = [];
  for (const relative of preflightTargets(config)) {
    const absolute = problemPath(problemId, relative);
    if (!(await exists(absolute))) continue;
    const { code, stderr } = await withSandboxScratch(async (scratch) =>
      runSandbox({
        command: "g++",
        args: ["-std=gnu++20", "-fsyntax-only", "-I/problem/include", "/problem/source.cpp"],
        mounts: [
          { hostPath: scratch, containerPath: "/work" },
          { hostPath: absolute, containerPath: "/problem/source.cpp", readOnly: true },
          { hostPath: includeDir, containerPath: "/problem/include", readOnly: true },
        ],
        timeoutMs: 90_000,
        memoryMb: 1024,
        maxOutputBytes: 16 * 1024 * 1024,
      }),
    );
    if (code === 0) continue;
    // Keep the compiler's own wording (it names the construct that is wrong)
    // but drop the absolute workspace prefixes and cap the volume: a broken
    // file can emit hundreds of cascade lines and the first few carry the cause.
    const detail = stderr
      .split(/\r?\n/)
      .filter((line) => /error:|note:/.test(line))
      .slice(0, 6)
      .map((line) => line.replace(/^[A-Za-z]:\\[^\s:]+\\/, "").trim())
      .join("\n");
    problems.push(`### ${relative}\n\`\`\`\n${detail || "(编译器未给出可读信息)"}\n\`\`\``);
  }
  return problems;
}

/**
 * Run the full preflight suite, recording each check's three-state outcome.
 *
 * Deliberately tolerant: a check that throws or cannot run is recorded as
 * "skipped" rather than failing the generation, so the normal verification run
 * still decides the outcome. Callers that only want the problem messages use
 * preflightCompile(), which flattens this report.
 */
export async function runPreflight(
  problemId: string,
  config: ProblemConfig,
): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];

  const add = async (
    id: string,
    title: string,
    fn: () => Promise<string[]>,
  ): Promise<void> => {
    try {
      const problems = await fn();
      checks.push({
        id,
        title,
        status: problems.length > 0 ? "failed" : "passed",
        problems,
      });
    } catch (error) {
      checks.push({
        id,
        title,
        status: "skipped",
        problems: [],
        reason: (error as Error).message,
      });
    }
  };

  const includeDir = problemPath(problemId, "include");
  if (!(await exists(path.join(includeDir, PREFLIGHT_HEADER)))) {
    // Nothing compiles without testlib, and every runtime check needs a compiled
    // binary. Report the suite as not-run rather than as a pass.
    return {
      checks: [
        {
          id: "compile",
          title: "编译预检",
          status: "skipped",
          problems: [],
          reason: "缺少 include/testlib.h，无法编译 generator/标程/checker",
        },
      ],
      problems: [],
      skipped: ["compile"],
    };
  }

  // config.json first: it is the file everything else depends on, and a broken
  // one makes every later check meaningless.
  await add("config-parseable", "config.json 可解析", () =>
    checkConfigParseable(problemId),
  );
  await add("interactive-config", "交互题 checker/interactor 字段", () =>
    checkInteractiveConfig(problemId, config),
  );
  await add("declared-format", "题面与 validator 的行格式", async () => {
    const mismatch = await checkDeclaredFormat(problemId, config);
    return mismatch ? [describeFormatMismatch(mismatch)] : [];
  });
  await add("wrong-substance", "错解是否有实质内容", () =>
    checkWrongSolutionSubstance(problemId, config),
  );
  await add("statement-language", "题面语言", () =>
    checkStatementLanguage(problemId, config),
  );
  await add("generator-types", "generator 与 config 的 type 契约", () =>
    checkGeneratorTypes(problemId, config),
  );
  // The statement's own samples against the generated data. This is the only
  // mechanical link between the statement and the artefacts, and it is what
  // catches a problem whose solutions answer a different question than the one
  // asked - the failure mode that mattered most, because self-consistency makes
  // it invisible to every other check.
  await add("declared-samples", "题面样例与生成数据一致", () =>
    checkDeclaredSamples(problemId, config),
  );

  // Runtime checks need the sandbox. The generator and validator are compiled
  // once and reused; the scratch outlives the runners (see
  // withSandboxedGeneratorAndValidator). If the tools cannot be built, the
  // runtime checks are recorded as skipped rather than passed.
  let metaTags: string[] = [];
  try {
    const metaRaw = JSON.parse(
      await fs.readFile(problemPath(problemId, "meta.json"), "utf8"),
    ) as { tags?: unknown };
    if (Array.isArray(metaRaw.tags)) {
      metaTags = metaRaw.tags.filter((x): x is string => typeof x === "string");
    }
  } catch {
    // No meta yet (first preflight): the statement fallback still applies.
  }

  let runGenerator: GeneratorRunner | null = null;
  let runValidator: ValidatorRunner | null = null;
  let toolError: string | null = null;
  try {
    await withSandboxedGeneratorAndValidator(
      problemId,
      config,
      async ({ runGenerator: gen, runValidator: val }) => {
        runGenerator = gen;
        runValidator = val;
        if (gen) {
          await add("tree-data", "树题数据合法性", () =>
            checkTreeData(problemId, config, gen, metaTags),
          );
          await add("case-distinctness", "case 数据互异性", () =>
            checkCaseDistinctness(problemId, config, gen),
          );
        }
        if (gen && val) {
          await add("validator-accepts", "validator 接受 generator 的输出", () =>
            checkValidatorAcceptsGenerator(problemId, config, gen, val),
          );
        }
      },
    );
  } catch (error) {
    toolError = (error as Error).message;
  }

  if (!runGenerator) {
    checks.push({
      id: "runtime",
      title: "运行时检查（树/区分度/validator）",
      status: "skipped",
      problems: [],
      reason: toolError ?? "generator 无法编译或缺失，运行时检查未执行",
    });
  } else if (!runValidator) {
    checks.push({
      id: "validator-accepts",
      title: "validator 接受 generator 的输出",
      status: "skipped",
      problems: [],
      reason: "validator 无法编译或缺失，未执行",
    });
  }

  // Compile diagnostics last: the slowest and least specific.
  await add("compile", "逐文件编译", () =>
    compileDiagnostics(problemId, config, includeDir),
  );

  const problems = checks.flatMap((c) => c.problems);
  const skipped = checks.filter((c) => c.status === "skipped").map((c) => c.id);
  return { checks, problems, skipped };
}

/**
 * Compile every source file without producing a binary, returning short
 * file-scoped diagnostics. Thin wrapper over runPreflight for callers that only
 * want the problem messages (the repair prompt, the recycle ticket).
 */
export async function preflightCompile(
  problemId: string,
  config: ProblemConfig,
): Promise<string[]> {
  return (await runPreflight(problemId, config)).problems;
}

/**
 * The build tree is keyed by config.slug, which differs from the numbered
 * problemId directory. Read it from the workspace's config.json; null when
 * the config is unreadable (the copy is then simply skipped).
 */
async function readConfigSlug(problemId: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(problemPath(problemId, "config.json"), "utf8");
    const parsed = JSON.parse(raw) as { slug?: unknown };
    return typeof parsed.slug === "string" && parsed.slug.trim() !== ""
      ? parsed.slug
      : null;
  } catch {
    return null;
  }
}
/** Run the skill's verifier against one workspace and persist the transcript. */
export async function verifyWorkspace(
  problemId: string,
): Promise<Verification> {
  const absolute = path.resolve(VERIFY_SCRIPT);
  if (!(await exists(absolute))) {
    throw new Error(`验题脚本不存在: ${absolute}`);
  }

  // Heal before verifying. Without this, a workspace missing a skill-owned
  // asset fails on every attempt and "重新验题" can never succeed - the repair
  // has to live on the verify path, not only on the scaffold path.
  await ensureWorkspaceAssets(problemId);

  // The verifier compiles and executes generated code, so run the complete
  // PowerShell toolchain inside the same locked-down container used for
  // submissions. The problem is read-only; only the isolated artifact mount is
  // writable and copied back after a successful container run.
  const result = await withSandboxScratch(async (scratch) => {
    const artifacts = path.join(scratch, "artifacts");
    await fs.mkdir(artifacts, { recursive: true });
    await fs.chmod(artifacts, 0o777).catch(() => {});
    const sandbox = await runSandbox({
      command: "pwsh",
      args: [
        "-NoProfile",
        "-File",
        "/skill/scripts/run-all-tests.ps1",
        "-Workspace",
        "/problem",
        "-ArtifactRoot",
        "/artifacts",
      ],
      mounts: [
        { hostPath: icpcSkillDir, containerPath: "/skill", readOnly: true },
        { hostPath: problemDir(problemId), containerPath: "/problem", readOnly: true },
        { hostPath: artifacts, containerPath: "/artifacts" },
      ],
      timeoutMs: 900_000,
      memoryMb: 2048,
      cpus: 2,
      pidsLimit: 128,
      maxOutputBytes: 64 * 1024 * 1024,
      tmpfsMb: 256,
    });

    // Judging consumes these artifacts later. Copy only the expected build
    // tree from the private mount, never anything written elsewhere.
    //
    // The build tree is keyed by the config's slug (e.g.
    // "shortest-path-count-bottleneck"), NOT by the problemId's numbered
    // directory (e.g. "greedy-017") - run-all-tests.ps1 names the build root
    // after config.slug. Copying by problemId silently matched nothing, the
    // generated data stayed in the scratch mount and was deleted with it,
    // which is why the console reported "验题数据目录尚未生成" after a
    // passing run.
    const buildSlug = await readConfigSlug(problemId);
    if (buildSlug) {
      const sourceBuild = path.join(artifacts, "build", buildSlug);
      if (await exists(sourceBuild)) {
        const destination = path.join(
          icpcSkillDir,
          ".codex-test-artifacts",
          "build",
          buildSlug,
        );
        await fs.rm(destination, { recursive: true, force: true });
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.cp(sourceBuild, destination, { recursive: true });
      }
    }    return {
      code: sandbox.code,
      stdout: sandbox.stdout,
      stderr: sandbox.stderr,
      output: `${sandbox.stdout}\n${sandbox.stderr}`,
    } satisfies RunResult;
  }).catch((error: Error) => {
    // requireSandbox threw before any container could start (Docker is down).
    // Turn it into a transcript so it is logged like any other run instead of
    // escaping as an exception the caller has to special-case.
    if (!isSandboxUnavailableError(error.message)) {
      throw error;
    }
    return {
      code: 1,
      stdout: "",
      stderr: error.message,
      output: error.message,
    } satisfies RunResult;
  });
  let verification = parseVerification(problemId, result.output, result.code);
  // Infrastructure failure: the sandbox never ran the problem. This is not a
  // defect in the problem, so it is recorded with a distinct marker that the
  // repair loop and the recycle report both recognise - otherwise a Docker
  // outage looks like a fixable failure and burns model calls trying to fix
  // code that was never the problem (graph-009 recorded exactly this as
  // "[verifier-crash] Docker Desktop is unable to start").
  if (!verification.passed && isSandboxUnavailableError(result.output)) {
    const detail = sandboxFailureLine(result.output) ?? "未知错误";
    verification = {
      ...verification,
      infrastructure: true,
      failures: [
        {
          scope: "sandbox",
          message:
            `[sandbox-unavailable] 验题沙箱不可用（Docker Desktop 未运行或已停止），` +
            `本次没有真正跑过题目，结果不代表题目对错。` +
            `请启动 Docker Desktop 后重新验题。原始错误：${detail}`,
        },
      ],
    };
  } else if (!verification.passed && !reachedVerdict(result.output)) {
    // A crash produces no failure lines, so the parsed report would read as
    // "0 failures" while passed is false - and the repair loop would then be
    // handed an empty digest, burn a model call, and change nothing (observed:
    // two consecutive repair rounds that rewrote 0 files). Record the crash as
    // the failure, so the digest and the console both say what actually happened.
    const crash = firstCrashLine(result.output) ?? "未知错误";
    verification = {
      ...verification,
      failures: [
        {
          scope: problemId,
          message:
            `[verifier-crash] 验题脚本未跑完就异常退出（exit=${result.code}），` +
            `因此没有产生失败清单。这不是题目本身答错，而是验题过程中断。` +
            `末尾错误：${crash}`,
        },
      ],
    };
  }

  // Prepend the data-coverage audit so the transcript records not just whether
  // the cases passed, but how much the case list actually covers. A pass on a
  // thin case list is still a pass, so this is the only place that distinction
  // gets written down.
  let auditLines: string[] = [];
  try {
    auditLines = formatCoverageForLog(auditCoverage(await readConfigFile(problemId)));
  } catch {
    // A config this cannot read is already reported by the verifier itself.
  }
  const transcript =
    auditLines.length > 0
      ? `${auditLines.join("\n")}\n\n${result.output}`
      : result.output;

  await fs.mkdir(LOG_DIR, { recursive: true });
  const stamp = verification.ranAt.replace(/[:.]/g, "-");
  const logName = `${problemId.replace("/", "-")}-${stamp}.log`;
  await fs.writeFile(path.join(LOG_DIR, logName), transcript, "utf8");

  return { ...verification, logPath: logName };
}

/**
 * Read a workspace config.json defensively.
 *
 * The verify path only needs the case list for the audit, so this reads the
 * raw file instead of going through the schema: a config with a validation
 * problem must still produce a verification result (the verifier is the
 * authority on what is wrong with it), not throw out of the audit.
 */
async function readConfigFile(problemId: string): Promise<ProblemConfig> {
  const raw = await fs.readFile(problemPath(problemId, "config.json"), "utf8");
  return problemConfigSchema.parse(JSON.parse(raw));
}

export type GeneratedFile = {
  /** Workspace relative, slash separated, e.g. "src/solution.cpp". */
  path: string;
  content: string;
};

/**
 * Whether a file block carries no usable content.
 *
 * A truncated model reply can emit a `<<<FILE x>>>` header with nothing after
 * it, which parses to an empty string. Writing that over an existing file
 * destroys working source code: observed as solution.cpp, checker.cpp and
 * validator.cpp all silently truncated to 0 bytes, after which every compile
 * failed with "undefined reference to `WinMain'" - the linker's way of saying
 * there is no main() at all. No source file in this pipeline is legitimately
 * empty (an empty .cpp cannot compile), so treating blank content as unusable
 * can never discard something intended.
 */
function isBlankContent(content: string): boolean {
  return content.trim() === "";
}

/**
 * Write generated files into a workspace.
 *
 * Contents come straight out of model output, so each path goes through
 * problemPath for containment and each write is atomic. Failures are collected
 * rather than thrown so one bad file does not abandon the rest of a role.
 *
 * Blank content never overwrites an existing file. The model truncating a
 * reply is a recoverable condition (the file keeps its previous content and the
 * caller sees a failure); destroying the file is not, because nothing later in
 * the pipeline has a copy to restore from.
 */
export async function writeGeneratedFiles(
  problemId: string,
  files: GeneratedFile[],
): Promise<{ written: string[]; failed: { path: string; error: string }[] }> {
  const written: string[] = [];
  const failed: { path: string; error: string }[] = [];

  for (const file of files) {
    let absolute: string;
    try {
      absolute = problemPath(problemId, file.path);
    } catch (error) {
      failed.push({ path: file.path, error: (error as Error).message });
      continue;
    }

    try {
      if (isBlankContent(file.content) && (await exists(absolute))) {
        failed.push({
          path: file.path,
          error: "模型输出的文件内容为空，已保留原有文件不予覆盖（回复可能被截断）",
        });
        continue;
      }

      await fs.mkdir(path.dirname(absolute), { recursive: true });
      const temporary = `${absolute}.tmp-${process.pid}-${written.length}`;
      await fs.writeFile(temporary, file.content, "utf8");
      await fs.rename(temporary, absolute);
      written.push(file.path);
    } catch (error) {
      failed.push({ path: file.path, error: (error as Error).message });
    }
  }

  return { written, failed };
}

export function verificationEnabled(): boolean {
  return process.env.RUN_VERIFICATION?.trim() !== "0";
}

/* ---------------------------------------------------------------------------
   Config / workspace reconciliation
   ---------------------------------------------------------------------------
   A workspace's config.json is written by several roles across several model
   calls, so it can reference .cpp files that were never actually produced -
   the role that owned them failed, dropped the file block, or the model named
   the file differently from the plan.

   The verifier resolves every solutions/wrongSolutions path while still
   parsing the config, and throws on the first one it cannot find. So a single
   phantom entry fails the whole run before a single case is generated:
   "wrong solution brute-force 不存在: ...\src\wrong\brute-force.cpp".

   Reconcile by dropping entries whose file is absent. This is not a lossy
   workaround: the drop only ever affects observe/fail bookkeeping for a file
   that does not exist, so there is nothing left to run. The main solution is
   never dropped - losing it is a real failure that must stay visible.
   ------------------------------------------------------------------------ */

/** A path is present when it resolves inside the workspace and exists. */
async function solutionFileExists(
  problemId: string,
  relative: string,
): Promise<boolean> {
  let absolute: string;
  try {
    // A path that escapes the workspace cannot name a real solution file, so
    // treat the containment rejection as "absent" rather than aborting the
    // reconcile and leaving every other phantom entry in place.
    absolute = problemPath(problemId, relative);
  } catch {
    return false;
  }
  return exists(absolute);
}

/**
 * Drop solutions/wrongSolutions entries whose source file is missing.
 *
 * Returns a description of what was dropped, or null when the config was
 * already consistent (the common case, and the reason this stays off the hot
 * path: it only writes when it actually changes something).
 */
export async function dropMissingSolutionEntries(
  problemId: string,
): Promise<string[] | null> {
  const configPath = problemPath(problemId, "config.json");

  let config: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    config = parsed as Record<string, unknown>;
  } catch {
    // An unreadable config is readConfig's error to report, with a far better
    // message than this function could produce.
    return null;
  }

  const dropped: string[] = [];

  for (const field of ["solutions", "wrongSolutions"] as const) {
    const value = config[field];
    if (!Array.isArray(value)) {
      continue;
    }
    const kept: unknown[] = [];
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null) {
        kept.push(entry);
        continue;
      }
      const item = entry as Record<string, unknown>;
      const relativePath =
        typeof item.path === "string" ? item.path : "";
      const name = typeof item.name === "string" ? item.name : relativePath;

      // A role=main solution is the reference answer. Dropping it silently
      // would turn a broken generation into a green-looking one, so keep it
      // and let the verifier report the missing file.
      if (field === "solutions" && item.role === "main") {
        kept.push(item);
        continue;
      }
      if (relativePath === "" || (await solutionFileExists(problemId, relativePath))) {
        kept.push(item);
        continue;
      }
      dropped.push(`${field}/${name} -> ${relativePath}`);
    }
    config[field] = kept;
  }

  if (dropped.length === 0) {
    return null;
  }

  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return dropped;
}
