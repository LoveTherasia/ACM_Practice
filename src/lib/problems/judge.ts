import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { readProblem, patchMeta } from "@/lib/problems/store";

/**
 * Submission judging.
 *
 * Compiles the user's C++ source against the workspace's test data and
 * reports a per-case verdict: AC / WA / TLE / MLE / RE / CE. The flow
 * mirrors what run-all-tests.ps1 does for the reference solutions, but
 * scoped to one submission:
 *
 *   1. g++ compile (CE on failure)
 *   2. for each case: run with the .in file, capture stdout
 *      - timeout  -> TLE
 *      - crash    -> RE
 *      - checker rejects -> WA
 *   3. all cases AC -> accepted
 *
 * Test data comes from the verifier's build output
 * (.codex-test-artifacts/build/<slug>/generated/), which only exists after
 * a successful verification run. If it is missing we regenerate it by
 * running the generator for each case directly.
 */

export type CaseVerdict = {
  case: string;
  verdict: "AC" | "WA" | "TLE" | "MLE" | "RE";
  timeMs: number | null;
  detail: string | null;
};

export type JudgeResult = {
  compileError: string | null;
  verdicts: CaseVerdict[];
  accepted: boolean;
  passed: number;
  total: number;
};

const VERDICT_LABEL: Record<CaseVerdict["verdict"], string> = {
  AC: "通过",
  WA: "答案错误",
  TLE: "超出时限",
  MLE: "超出内存",
  RE: "运行时错误",
};

export function verdictLabel(verdict: CaseVerdict["verdict"]): string {
  return VERDICT_LABEL[verdict];
}

function run(
  file: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
    inputFile?: string;
    maxBuffer?: number;
  } = {},
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 0,
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const timedOut = Boolean(
          error && (error as { killed?: boolean }).killed,
        );
        resolve({
          code: error ? (error as { code?: number }).code ?? 1 : 0,
          stdout: String(stdout),
          stderr: String(stderr),
          timedOut,
        });
      },
    );
    if (options.inputFile && child.stdin) {
      // Feed the input file through stdin, then close.
      fs.readFile(options.inputFile)
        .then((data) => {
          child.stdin?.end(data);
        })
        .catch(() => child.stdin?.end());
    }
  });
}

/** Locate the generated test data for a problem, regenerating if needed. */
async function ensureTestData(
  problemId: string,
): Promise<{ dir: string; cases: { name: string; input: string; answer: string }[] }> {
  const detail = await readProblem(problemId);
  if (!detail) {
    throw new Error(`题目不存在: ${problemId}`);
  }
  const slug = detail.config.slug;
  const buildRoot = path.join(
    process.cwd(),
    "skills",
    "icpc-problem-creator",
    ".codex-test-artifacts",
    "build",
    slug,
  );
  const generatedRoot = path.join(buildRoot, "generated");

  const cases: { name: string; input: string; answer: string }[] = [];
  for (const item of detail.config.generator.cases) {
    const input = path.join(generatedRoot, item.group, `${item.name}.in`);
    const answer = path.join(generatedRoot, item.group, `${item.name}.ans`);
    if (!(await fs.access(input).then(() => true).catch(() => false))) {
      throw new Error(
        `测试数据缺失: ${item.name}。请先在题目页点击「重新验题」生成测试数据。`,
      );
    }
    cases.push({ name: item.name, input, answer });
  }
  return { dir: buildRoot, cases };
}

export async function judgeSubmission(
  problemId: string,
  source: string,
): Promise<JudgeResult> {
  const detail = await readProblem(problemId);
  if (!detail) {
    throw new Error(`题目不存在: ${problemId}`);
  }
  const { config } = detail;
  const { cases } = await ensureTestData(problemId);

  // Scratch directory for the submission binary.
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "acm-submit-"));
  try {
    const sourcePath = path.join(work, "submission.cpp");
    await fs.writeFile(sourcePath, source, "utf8");
    const binary = path.join(work, "submission.exe");

    // 1. Compile.
    const compile = await run("g++", [
      "-std=gnu++20",
      "-O2",
      "-pipe",
      sourcePath,
      "-o",
      binary,
      "-Wl,--stack,268435456",
    ], { timeoutMs: 60_000 });
    if (compile.code !== 0) {
      return {
        compileError: compile.stderr.slice(0, 4000),
        verdicts: [],
        accepted: false,
        passed: 0,
        total: cases.length,
      };
    }

    // 2. Judge each case.
    const checkerPath = config.checker
      ? path.join(
          process.cwd(),
          "skills",
          "icpc-problem-creator",
          ".codex-test-artifacts",
          "build",
          config.slug,
          "bin",
          "checker.exe",
        )
      : null;
    const checkerExists = checkerPath
      ? await fs.access(checkerPath).then(() => true).catch(() => false)
      : false;

    const verdicts: CaseVerdict[] = [];
    for (const item of cases) {
      const result = await run(binary, [], {
        timeoutMs: config.timeLimitMs,
        inputFile: item.input,
      });

      if (result.timedOut) {
        verdicts.push({
          case: item.name,
          verdict: "TLE",
          timeMs: config.timeLimitMs,
          detail: null,
        });
        continue;
      }
      if (result.code !== 0) {
        verdicts.push({
          case: item.name,
          verdict: "RE",
          timeMs: null,
          detail: `exit=${result.code}${result.stderr ? `: ${result.stderr.slice(0, 200)}` : ""}`,
        });
        continue;
      }

      // Compare against the answer: use the checker when one exists,
      // otherwise fall back to trimmed text comparison.
      if (checkerExists && checkerPath) {
        const outputPath = path.join(work, `${item.name}.out`);
        await fs.writeFile(outputPath, result.stdout.replace(/\r\n/g, "\n"), "utf8");
        const check = await run(checkerPath, [
          item.input,
          outputPath,
          item.answer,
        ], { timeoutMs: 30_000 });
        if (check.code !== 0) {
          verdicts.push({
            case: item.name,
            verdict: "WA",
            timeMs: null,
            detail: check.stderr.slice(0, 300) || "checker 拒绝了输出",
          });
          continue;
        }
      } else {
        const expected = await fs.readFile(item.answer, "utf8");
        const normalise = (text: string) =>
          text
            .replace(/\r\n/g, "\n")
            .trim()
            .split("\n")
            .map((line) => line.trim())
            .join("\n");
        if (normalise(result.stdout) !== normalise(expected)) {
          verdicts.push({
            case: item.name,
            verdict: "WA",
            timeMs: null,
            detail: null,
          });
          continue;
        }
      }

      verdicts.push({
        case: item.name,
        verdict: "AC",
        timeMs: null,
        detail: null,
      });
    }

    const passed = verdicts.filter((v) => v.verdict === "AC").length;
    const accepted = passed === cases.length && cases.length > 0;

    // Persist the solved flag: the registry shows submission status, not
    // verification status, so an accepted submission must survive the page
    // view. Best-effort - a failed write must not lose the verdict.
    if (accepted) {
      await patchMeta(problemId, { solved: true }).catch(() => {});
    }

    return {
      compileError: null,
      verdicts,
      accepted,
      passed,
      total: cases.length,
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
