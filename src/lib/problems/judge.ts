import { promises as fs } from "node:fs";
import path from "node:path";

import { problemPath } from "@/lib/paths";
import { patchMeta, readProblem } from "@/lib/problems/store";
import { runSandbox, withSandboxScratch } from "@/lib/sandbox/docker";

/** All contestant-controlled code executes exclusively in the Docker sandbox. */
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

type TestCase = { name: string; input: string; answer: string };

async function ensureTestData(problemId: string): Promise<TestCase[]> {
  const detail = await readProblem(problemId);
  if (!detail) throw new Error(`题目不存在: ${problemId}`);
  const generatedRoot = path.join(
    process.cwd(), "skills", "icpc-problem-creator", ".codex-test-artifacts",
    "build", detail.config.slug, "generated",
  );
  const cases: TestCase[] = [];
  for (const item of detail.config.generator.cases) {
    const input = path.join(generatedRoot, item.group, `${item.name}.in`);
    const answer = path.join(generatedRoot, item.group, `${item.name}.ans`);
    const present = await Promise.all(
      [input, answer].map((file) => fs.access(file).then(() => true).catch(() => false)),
    );
    if (!present.every(Boolean)) {
      throw new Error(
        `测试数据缺失: ${item.name}。请先点击「重新验题」，由安全沙箱生成测试数据。`,
      );
    }
    cases.push({ name: item.name, input, answer });
  }
  return cases;
}

function safeCaseName(name: string, index: number): string {
  return `${String(index).padStart(4, "0")}-${name.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
}

export async function judgeSubmission(
  problemId: string,
  source: string,
): Promise<JudgeResult> {
  const detail = await readProblem(problemId);
  if (!detail) throw new Error(`题目不存在: ${problemId}`);
  if (detail.config.interactive) {
    throw new Error("交互题提交尚未开放；普通题与 Special Judge 题均已支持安全评测。");
  }
  const cases = await ensureTestData(problemId);

  return withSandboxScratch(async (scratch) => {
    const work = path.join(scratch, "work");
    const data = path.join(scratch, "data");
    await fs.mkdir(work, { recursive: true });
    await fs.mkdir(data, { recursive: true });
    await fs.chmod(work, 0o777).catch(() => {});
    await fs.writeFile(path.join(work, "submission.cpp"), source, "utf8");

    const compile = await runSandbox({
      command: "g++",
      args: ["-std=gnu++20", "-O2", "-pipe", "/work/submission.cpp", "-o", "/work/submission"],
      mounts: [{ hostPath: work, containerPath: "/work" }],
      timeoutMs: 60_000,
      memoryMb: 1024,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    if (compile.code !== 0) {
      return {
        compileError: compile.stderr.slice(0, 4000) || "编译失败",
        verdicts: [], accepted: false, passed: 0, total: cases.length,
      };
    }

    const checkerSource = detail.config.checker
      ? problemPath(problemId, detail.config.checker)
      : null;
    if (!checkerSource) throw new Error("普通题没有配置 checker，无法判题");
    const checkerCompile = await runSandbox({
      command: "g++",
      args: ["-std=gnu++20", "-O2", "-DFOR_LINUX", "-I/problem/include", "/problem/checker.cpp", "-o", "/work/checker"],
      mounts: [
        { hostPath: work, containerPath: "/work" },
        { hostPath: checkerSource, containerPath: "/problem/checker.cpp", readOnly: true },
        { hostPath: problemPath(problemId, "include"), containerPath: "/problem/include", readOnly: true },
      ],
      timeoutMs: 60_000,
      memoryMb: 1024,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    if (checkerCompile.code !== 0) {
      throw new Error(`Special Judge 编译失败：${checkerCompile.stderr.slice(0, 2000)}`);
    }

    const verdicts: CaseVerdict[] = [];
    for (const [index, item] of cases.entries()) {
      const caseName = safeCaseName(item.name, index);
      const input = path.join(data, `${caseName}.in`);
      const answer = path.join(data, `${caseName}.ans`);
      const output = path.join(work, "contestant.out");
      await fs.copyFile(item.input, input);
      await fs.copyFile(item.answer, answer);
      await fs.rm(output, { force: true });

      const started = performance.now();
      const result = await runSandbox({
        command: "/work/submission",
        mounts: [{ hostPath: work, containerPath: "/work" }],
        workdir: "/work",
        input: await fs.readFile(input),
        timeoutMs: detail.config.timeLimitMs + 1_000,
        memoryMb: detail.config.memoryLimitMb,
        maxOutputBytes: 64 * 1024 * 1024,
      });
      const timeMs = Math.round(performance.now() - started);
      if (result.timedOut) {
        verdicts.push({ case: item.name, verdict: "TLE", timeMs, detail: null });
        continue;
      }
      if (result.memoryExceeded) {
        verdicts.push({ case: item.name, verdict: "MLE", timeMs, detail: null });
        continue;
      }
      if (result.outputLimitExceeded) {
        verdicts.push({ case: item.name, verdict: "RE", timeMs, detail: "输出超过 64 MiB" });
        continue;
      }
      if (result.code !== 0) {
        verdicts.push({
          case: item.name, verdict: "RE", timeMs,
          detail: `exit=${result.code}${result.stderr ? `: ${result.stderr.slice(0, 300)}` : ""}`,
        });
        continue;
      }
      await fs.writeFile(output, result.stdout.replace(/\r\n/g, "\n"), "utf8");

      // True Special Judge semantics: input, contestant output and jury answer
      // are passed to the generated testlib checker. Non-unique valid outputs
      // are accepted whenever that checker accepts them.
      const check = await runSandbox({
        command: "/work/checker",
        args: [
          `/data/${path.basename(input)}`,
          "/work/contestant.out",
          `/data/${path.basename(answer)}`,
        ],
        mounts: [
          { hostPath: work, containerPath: "/work" },
          { hostPath: data, containerPath: "/data", readOnly: true },
        ],
        timeoutMs: 10_000,
        memoryMb: 256,
        maxOutputBytes: 1024 * 1024,
      });
      verdicts.push(
        check.code === 0 && !check.timedOut
          ? { case: item.name, verdict: "AC", timeMs, detail: null }
          : {
              case: item.name, verdict: "WA", timeMs,
              detail: (check.stderr || check.stdout).slice(0, 500) || "checker 拒绝了输出",
            },
      );
    }

    const passed = verdicts.filter((item) => item.verdict === "AC").length;
    const accepted = cases.length > 0 && passed === cases.length;
    if (accepted) await patchMeta(problemId, { solved: true }).catch(() => {});
    return { compileError: null, verdicts, accepted, passed, total: cases.length };
  });
}
