import { promises as fs } from "node:fs";
import path from "node:path";

import { problemPath } from "@/lib/paths";
import type { ProblemConfig } from "@/lib/problems/schema";

/**
 * Sample I/O reconciliation.
 *
 * The verifier proves the artefacts agree *with each other*, which is not the
 * same as agreeing with the statement - and the difference shipped a broken
 * problem. On math-003 the solutions implemented "n - distinct values" while
 * the statement asked for "n - max_x count(x | a_i)"; the generator derived the
 * expected answers from the same wrong solutions, so all 32 cases passed and the
 * statement's own sample contradicted the data. Local verification cannot see
 * that by construction, because run-all-tests.ps1 never opens the statement.
 *
 * One thing it *can* see mechanically is the sample: the statement publishes
 * concrete input and output for at least one case, and the generator produces a
 * `sample-*` case with an expected answer. If those disagree, the statement and
 * the data describe different problems - no judgement required, just a
 * comparison. Measured on math-003: the statement's first sample block said 2,
 * its own later block said 0, and the generated answer was 0, so this check
 * fires on two independent disagreements.
 *
 * Deliberately narrow: only the samples, only the first mismatch per sample.
 * Samples exist precisely so a human can check the problem by hand, so any
 * disagreement is a defect rather than a matter of taste.
 */

/** A ```inputN / ```outputN pair from the statement. */
type DeclaredSample = { index: string; input: string; output: string };

export type ParsedSamples = {
  samples: DeclaredSample[];
  /**
   * Labels that appeared more than once.
   *
   * A model that changes its mind mid-statement leaves the first attempt in
   * place and appends a second one, so the statement ends up carrying two
   * different samples under the same label. Observed on graph-003, whose fence
   * labels were `input1, output1, input1, output2`, and on math-003, where the
   * two copies disagreed about the answer outright. The duplicate is itself a
   * defect worth reporting, and the FIRST occurrence wins: it sits with the
   * statement's own sample section, whereas the later one is the stray rewrite.
   */
  duplicates: string[];
};

/** Extract ```inputN ... ``` and ```outputN ... ``` blocks. */
export function parseDeclaredSamplesDetailed(statement: string): ParsedSamples {
  const blocks = new Map<string, { input?: string; output?: string }>();
  const duplicates = new Set<string>();

  /*
   * Statements number their samples inconsistently: some label the first pair
   * `input1`/`output1`, others leave it unnumbered (`input`/`output`) and number
   * only the following ones. Both spellings must land on the same index, or a
   * statement whose first fence is bare gets shifted by one and every later
   * comparison is against the wrong case.
   */
  const fence = /```(input|output)(\d*)[ \t]*\r?\n([\s\S]*?)```/g;
  let unnumberedUsed = false;

  for (const match of statement.matchAll(fence)) {
    const kind = match[1] as "input" | "output";
    const explicit = match[2] ?? "";
    let index: string;
    if (explicit !== "") {
      index = explicit;
    } else if (!unnumberedUsed) {
      index = "1";
      unnumberedUsed = true;
    } else {
      continue;
    }

    const entry = blocks.get(index) ?? {};
    if (entry[kind] !== undefined) {
      // Keep the first occurrence; note the collision.
      duplicates.add(`${kind}${index}`);
      continue;
    }
    entry[kind] = (match[3] ?? "").replace(/\r\n/g, "\n").trim();
    blocks.set(index, entry);
  }

  const samples: DeclaredSample[] = [];
  for (const [index, entry] of blocks) {
    if (entry.input !== undefined && entry.output !== undefined) {
      samples.push({ index, input: entry.input, output: entry.output });
    }
  }
  return { samples, duplicates: [...duplicates].sort() };
}

/** Convenience wrapper for callers that only need the samples. */
export function parseDeclaredSamples(statement: string): DeclaredSample[] {
  return parseDeclaredSamplesDetailed(statement).samples;
}

/** Whitespace-insensitive comparison, as the verifier itself uses. */
export function normalizeForCompare(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** Find generated test data for a sample index, wherever the generator put it. */
async function findGeneratedSample(
  buildRoot: string,
  slug: string,
  index: string,
): Promise<{ input: string; answer: string } | null> {
  const root = path.join(buildRoot, slug, "generated");
  const names = [`sample-${index}`, `sample${index}`, `sample_${index}`];

  let dirs: string[] = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }

  for (const name of names) {
    for (const dir of dirs) {
      try {
        const input = await fs.readFile(path.join(root, dir, `${name}.in`), "utf8");
        const answer = await fs.readFile(path.join(root, dir, `${name}.ans`), "utf8");
        return { input, answer };
      } catch {
        // Try the next location.
      }
    }
  }
  return null;
}

/** Where the verifier keeps compiled artefacts for a problem. */
function buildRoot(): string {
  return path.join(
    process.cwd(),
    "skills",
    "icpc-problem-creator",
    ".codex-test-artifacts",
    "build",
  );
}

export type SampleSyncResult = {
  /** Samples written into the verifier's data directory. */
  written: { index: string; path: string }[];
  /** Samples whose declared output disagrees with the solution's answer. */
  mismatches: {
    index: string;
    declaredOutput: string;
    actualOutput: string;
    /** The generator's own data for this sample, for the report. */
    generatedInput: string;
  }[];
  /** Why nothing could be synced, when that is the case. */
  skipped?: string;
};

/** Locate the verifier's generated data directory for a slug. */
async function generatedDir(slug: string): Promise<string | null> {
  const root = path.join(buildRoot(), slug, "generated");
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const dir = entries.find((e) => e.isDirectory());
    return dir ? path.join(root, dir.name) : null;
  } catch {
    return null;
  }
}

/**
 * Force the statement's samples into the verifier's data set.
 *
 * The generator is asked to reproduce the statement's samples verbatim, but a
 * prompt is a request, not a guarantee: one generation run produced `1000 1000`
 * of random values for a sample the statement declared as `5 3 / 1 2 1 3 2`.
 * Whenever that happens the sample never reaches verification, the `.ans` is the
 * answer to some other input, and the statement can drift arbitrarily far from
 * the artefacts while every check still reports success - which is exactly how a
 * problem with two self-contradicting samples passed 32/32.
 *
 * So the statement wins. This overwrites the generated sample inputs with the
 * declared ones, runs the main solution to produce the expected answers, and
 * reports any sample whose declared output disagrees with that answer. The
 * verifier then tests those cases for real, and the disagreement becomes a hard
 * failure naming the sample instead of a silent drift.
 *
 * The invalidation of the generated `.out` files matters: run-all-tests.ps1
 * skips regenerating a `.in` that already exists, so leaving stale artefacts
 * would let the old run's outputs be reused against the new inputs.
 */
export async function syncDeclaredSamples(
  problemId: string,
  config: ProblemConfig,
  runSolution: (name: string, input: string) => Promise<string | null>,
): Promise<SampleSyncResult> {
  let statement: string;
  try {
    statement = await fs.readFile(problemPath(problemId, config.statement), "utf8");
  } catch {
    return { written: [], mismatches: [], skipped: "无法读取题面" };
  }

  const { samples } = parseDeclaredSamplesDetailed(statement);
  if (samples.length === 0) {
    return { written: [], mismatches: [], skipped: "题面没有可解析的样例" };
  }

  const dir = await generatedDir(config.slug);
  if (!dir) {
    return { written: [], mismatches: [], skipped: "验题数据目录尚未生成" };
  }

  const result: SampleSyncResult = { written: [], mismatches: [] };

  for (const sample of samples) {
    const names = [`sample-${sample.index}`, `sample${sample.index}`];
    let inputPath: string | null = null;
    for (const name of names) {
      const candidate = path.join(dir, `${name}.in`);
      try {
        await fs.access(candidate);
        inputPath = candidate;
        break;
      } catch {
        // Try the next spelling.
      }
    }
    if (!inputPath) {
      continue;
    }

    const base = inputPath.replace(/\.in$/, "");
    const generatedInput = await fs.readFile(inputPath, "utf8").catch(() => "");

    // The statement's text is authoritative; normalise the line endings only.
    const declaredInput = sample.input.replace(/\r\n/g, "\n").trimEnd() + "\n";
    await fs.writeFile(inputPath, declaredInput, "utf8");

    // Any answer or solution output for the OLD input is now stale. The verifier
    // skips cases whose .in already exists, so clearing these is what makes it
    // regenerate from the input we just wrote.
    try {
      const siblings = await fs.readdir(dir);
      const prefix = `${path.basename(base)}.`;
      await Promise.all(
        siblings
          .filter((f) => f.startsWith(prefix) && (f.endsWith(".ans") || f.endsWith(".out")))
          .map((f) => fs.rm(path.join(dir, f), { force: true })),
      );
    } catch {
      // Removing stale artefacts is best-effort.
    }

    result.written.push({ index: sample.index, path: inputPath });

    // Ask a passing solution what this input produces, so the declared output
    // can be checked against a real answer rather than trusted.
    const actual = await runSolution("main", declaredInput);
    if (actual === null || actual.trim() === "") {
      // The solution crashed or produced nothing: that is a different defect,
      // reported by the verifier itself. Never call the statement wrong on the
      // strength of a run that did not complete.
      continue;
    }
    const declaredOutput = normalizeForCompare(sample.output);
    const actualOutput = normalizeForCompare(actual);
    if (declaredOutput !== actualOutput) {
      result.mismatches.push({
        index: sample.index,
        declaredOutput,
        actualOutput,
        generatedInput,
      });
    }
  }

  return result;
}

/** Format a sync result as a repair-facing diagnostic. */
export function describeSampleSync(result: SampleSyncResult): string[] {
  const problems: string[] = [];

  if (result.mismatches.length > 0) {
    const detail = result.mismatches.map((m) =>
      [
        `样例 ${m.index}：`,
        `  题面声明的输出：${m.declaredOutput.split("\n").join(" / ")}`,
        `  标程算出的输出：${m.actualOutput.split("\n").join(" / ")}`,
      ].join("\n"),
    );
    problems.push(
      [
        "### 题面声明的样例输出与标程的答案不一致",
        "```",
        detail.join("\n"),
        "```",
        "题面里写死了这些样例的输出，而这个输出**不等于标程对同一输入的答案**。",
        "两者必有一个是错的，而这个矛盾**验题本身查不出来**（验题只比较数据与标程，",
        "从不打开题面）。",
        "",
        "请判断是哪一边错了：",
        "- **标程错**：说明它实现的算法与题面不是同一个问题——重写标程，",
        "  并重新生成全部数据（`n - 不同值个数` vs `n - max_x count(x | a_i)` 那次事故就是这样）；",
        "- **题面错**：修正 `docs/statement.md` 里的样例输出与样例解释。",
        "不要只把数字改成一致了事——两边不一致说明对题意的理解有分歧，必须消除分歧。",
      ].join("\n"),
    );
  }

  return problems;
}


/**
 * Compare every declared sample with the generated data.
 *
 * Returns repair-facing diagnostics. Only runs once the verifier has produced
 * test data, so a first run reports nothing here and the check takes effect on
 * the next round - which is the right trade: the alternative is generating the
 * samples a second time inside the preflight.
 */
export async function checkDeclaredSamples(
  problemId: string,
  config: ProblemConfig,
): Promise<string[]> {
  let statement: string;
  try {
    statement = await fs.readFile(problemPath(problemId, config.statement), "utf8");
  } catch {
    return [];
  }

  const { samples, duplicates } = parseDeclaredSamplesDetailed(statement);

  const problems: string[] = [];

  // A statement carrying the same sample label twice has been edited in place
  // rather than rewritten. The two copies can disagree - on math-003 one said
  // the answer was 2 and the other 0 - which leaves the reader (and any
  // comparison) with no way to know which one the problem means.
  if (duplicates.length > 0) {
    problems.push(
      [
        "### 题面里有重复的样例块",
        "```",
        `重复的标签：${duplicates.join(", ")}`,
        "```",
        "同一份题面里同一个样例出现了两次，说明题面是在草稿上**追加修改**的，",
        "而不是重写——前一次的样例没有被删掉。实测中这类重复的样例彼此矛盾",
        "（例如一处写答案 2、另一处写 0），而 generator 可能只跟了其中一份。",
        "",
        "请把 `docs/statement.md` 的样例部分**整体重写**，只保留一组样例，",
        "并确保它与生成数据一致。不要试图只删掉多余的那一块——",
        "两份样例不一致说明写题面时对题意有过动摇，请先确认到底哪个答案是对的。",
      ].join("\n"),
    );
  }

  if (samples.length === 0) {
    return problems;
  }

  // The config must carry one sample case per declared sample, or some sample
  // never reaches the verifier. Observed on greedy-014: two declared samples but
  // a single sample case, so the second was silently never tested.
  const sampleCases = config.generator.cases.filter((c) => c.type === "sample");
  if (sampleCases.length < samples.length) {
    problems.push(
      [
        "### config 里的 sample case 少于题面样例数",
        "```",
        `题面声明 ${samples.length} 组样例，config 里只有 ${sampleCases.length} 个 type="sample" 的 case`,
        `已有的 sample case：${sampleCases.map((c) => c.name).join(", ") || "（无）"}`,
        "```",
        "少掉的样例不会被生成，也就**永远不会被验题验证**——它只存在于题面里。",
        "请为题面的每一组样例都补一个 `type: \"sample\"` 的 case（顺序与 inputN 编号一致）。",
      ].join("\n"),
    );
  }
  for (const sample of samples) {
    const generated = await findGeneratedSample(buildRoot(), config.slug, sample.index);
    if (!generated) {
      continue;
    }

    const declaredInput = normalizeForCompare(sample.input);
    const actualInput = normalizeForCompare(generated.input);
    const declaredOutput = normalizeForCompare(sample.output);
    const actualOutput = normalizeForCompare(generated.answer);

    if (declaredInput === actualInput && declaredOutput === actualOutput) {
      continue;
    }

    const parts = [
      `### 题面样例 ${sample.index} 与生成的数据不一致`,
      "```",
      declaredInput !== actualInput
        ? [
            `题面声明的输入：\n${declaredInput}`,
            `生成器产出的输入：\n${actualInput}`,
          ].join("\n\n")
        : `输入一致。\n题面声明的输出：${declaredOutput}`,
      declaredInput === actualInput
        ? `生成数据的期望输出：${actualOutput}`
        : `题面声明的输出：${declaredOutput}\n生成数据的期望输出：${actualOutput}`,
      "```",
      "样例是题面里唯一**可机械比对**的部分，所以它们对不上时，",
      "题面与数据描述的就不是同一道题。这类问题**验题永远查不出来**：",
      "验题只比较数据与标程是否互相一致，而从不打开题面。",
      "",
      "请先判断**哪一边是对的**，再统一三处（题面、generator、标程与 .ans）：",
      "- 若题面的样例是对的：说明标程算法与题面不符（math-003 就是这样：",
      "  标程算 `n - 不同值个数`，而题面要求 `n - max_x count(x | a_i)`），",
      "  需要重写标程并重新生成数据；",
      "- 若生成的数据是对的：说明题面的样例写错了（例如模型在题面里留下了",
      "  『重新核算』的草稿，导致同一份样例出现两个互相矛盾的输出）。",
      "不要只改数字了事——两边不一致说明对题意的理解有分歧，必须消除分歧。",
    ];
    problems.push(parts.join("\n"));
    // One mismatch is enough to make the point; the rest are the same defect.
    break;
  }

  return problems;
}
