import { promises as fs } from "node:fs";

import { problemPath } from "@/lib/paths";
import type { ProblemConfig } from "@/lib/problems/schema";

/**
 * Statement / validator format reconciliation.
 *
 * Local verification proves the artefacts are consistent *with each other*. It
 * cannot prove they match the statement, because run-all-tests.ps1 never reads
 * docs/statement.md. On dp-009 that gap produced a problem which passed 37/37
 * and was still worthless: the statement described a weighted-graph MST, while
 * the validator, generator and BOTH reference solutions all implemented
 * "read n, sum n integers". They agreed with each other perfectly and had
 * nothing to do with the statement.
 *
 * This is the cheapest available mechanical proxy for that alignment, focused
 * on the single most informative sentence in any statement: the first line of
 * the input format. It compares LINE STRUCTURE - the statement says the opening
 * values share one line, so a validator that demands several lines rejects a
 * contestant who followed the statement. graph-001 is exactly that case: it
 * reads n, readEoln, m, readEoln (two lines) while its statement declares
 * "第一行两个整数 n 和 m" (one line). It passes verification only because its
 * generator emits the two-line form, so data and validator agree with each
 * other and disagree with the statement.
 *
 * Deliberately narrow, and deliberately silent when unsure. An earlier version
 * counted VALUES rather than lines and misread that same graph-001 as fine,
 * because every value was in fact read - just on the wrong lines. Counting
 * prose more aggressively would trade that kind of miss for false alarms, and a
 * check that cries wolf is one nobody reads.
 */

/** The first sentence of the input-format section that mentions 第一行. */
function declaredFirstLine(statement: string): string | null {
  const start = statement.indexOf("输入格式");
  if (start === -1) {
    return null;
  }
  // Stop at the next section so a later "第一行" cannot be picked up.
  const rest = statement.slice(start);
  const nextSection = rest.search(/\n#{2,3}\s/);
  const section = nextSection === -1 ? rest : rest.slice(0, nextSection);

  const sentence = section
    .split(/\n/)
    .map((line) => line.trim())
    .find((line) => /第\s*一\s*行/.test(line));
  return sentence ?? null;
}

/**
 * How many values the statement says the first line holds.
 *
 * Counts the variable groups between 第一行 and the end of that clause:
 * "$n$ 与 $m$" is two, "$n$" is one. Returns null when the sentence does not
 * enumerate anything countable, so a prose-only statement is simply skipped.
 */
function declaredFirstLineCount(sentence: string): number | null {
  // Colon form ("第一行：n m") or comma form ("第一行，两个整数 n 与 m").
  const afterMarker = sentence.replace(/^[^：:]*[：:]/, "").trim();
  // Keep only up to the first clause break (the explanation that follows).
  const clause = afterMarker.split(/[。；;，,]/)[0] ?? "";
  if (clause.trim() === "") {
    return null;
  }

  // Drop the leading description ("两个整数", "两个数", "整数") so only the
  // variable list remains; it is what gets counted.
  const variables = clause
    .replace(/^[^$A-Za-z]*?(?:\d+\s*个)?\s*(?:整数|数|数字|int|integer)?\s*/i, "")
    .trim();
  if (variables === "") {
    return null;
  }

  const groups = variables
    .split(/\s*(?:和|与|及|,|，|、)\s*/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (groups.length === 0) {
    return null;
  }
  // A group with no letters/digits at all is prose, not a variable list.
  const looksLikeVariables = groups.every((part) => /[$A-Za-z]/.test(part));
  return looksLikeVariables ? groups.length : null;
}

/**
 * The format check's real comparison is LINE STRUCTURE, not value count.
 *
 * Counting values alone produced a wrong reading on graph-001: its statement
 * declares "第一行两个整数 n 和 m" (one line, two values) while the validator
 * reads n, readEoln, m, readEoln - it demands TWO lines. Every value is read
 * correctly, so a value-count check would have called it fine, yet a contestant
 * following the statement writes "n m" on one line and is rejected at the
 * second readEoln. The validator is stricter than the statement, and that is a
 * genuine, contestant-visible defect.
 *
 * So the validator side counts lines: consecutive "read ... readEoln" pairs at
 * the top of main. If the statement puts k values on the first line and the
 * validator spells that as k lines, the two documents disagree about the
 * format.
 */

/**
 * How many read-then-EOL lines the validator opens with.
 *
 * Takes the text before the first loop or branch - the header block, where a
 * statement's opening lines are parsed - and counts the `readEoln()` calls in
 * it. Returns null when there are none, so a validator whose leading structure
 * cannot be identified stays silent rather than guessing.
 */
function validatorLeadingLines(validatorSource: string): number | null {
  const mainIndex = validatorSource.indexOf("int main");
  if (mainIndex === -1) {
    return null;
  }
  const body = validatorSource.slice(mainIndex);

  const stop = body.search(/\b(?:for|while|if|switch)\s*\(/);
  const header = stop === -1 ? body : body.slice(0, stop);
  const eoln = header.match(/\binf\.readEoln\s*\(\s*\)\s*;/g);
  return eoln && eoln.length > 0 ? eoln.length : null;
}

export type FormatMismatch = {
  /** Lines the statement's first line implies (always 1 when it says 第一行). */
  actualLines: number;
  sentence: string;
};

/**
 * Compare the statement's declared first line with the validator's line structure.
 *
 * Returns null whenever either side cannot be counted - a missing statement, an
 * unparseable sentence, a validator with no identifiable header. Silence on
 * uncertainty is the whole point: this check must never cry wolf, or it will be
 * ignored exactly when it matters.
 *
 * Only the "validator is stricter" direction is reported. A validator that
 * accepts one line where the statement describes two is lenient rather than
 * wrong, and calling that a defect would produce exactly the noise that makes a
 * check worthless.
 */
export async function checkDeclaredFormat(
  problemId: string,
  config: ProblemConfig,
): Promise<FormatMismatch | null> {
  let statement: string;
  let validator: string;
  try {
    statement = await fs.readFile(problemPath(problemId, config.statement), "utf8");
    validator = await fs.readFile(problemPath(problemId, config.validator), "utf8");
  } catch {
    return null;
  }

  const sentence = declaredFirstLine(statement);
  if (!sentence) {
    return null;
  }
  const declaredValues = declaredFirstLineCount(sentence);
  const actualLines = validatorLeadingLines(validator);
  if (declaredValues === null || actualLines === null) {
    return null;
  }

  // The statement puts these values on ONE line. A validator demanding more
  // than one line rejects a contestant who followed the statement.
  if (actualLines > 1) {
    return { actualLines, sentence };
  }
  return null;
}

/**
 * How many input values a source file reads.
 *
 * `readEoln`/`readEof`/`readSpace` are format checks, not values, so only the
 * value-reading calls are counted. scanf/stream extraction are included because
 * the solutions read with those rather than testlib.
 */
function countInputReads(source: string): number {
  const testlib =
    source.match(
      /\b(?:inf|ouf|ans)\.(?:readInt|readLong|readDouble|readToken|readWord|readStrictDouble|readReal)\s*\(/g,
    ) ?? [];
  const scanfs = source.match(/\bscanf\s*\(/g) ?? [];
  const streamReads = source.match(/\bcin\s*>>/g) ?? [];
  return testlib.length + scanfs.length + streamReads.length;
}

/**
 * Flag "wrong" solutions that never read the problem's input.
 *
 * A wrong solution is only useful as an observation probe if it is a real
 * attempt at the problem: it must consume the declared input and then get it
 * wrong in a specific way. Measured output on graph-004: both wrong solutions
 * read a single `n` and printed `n+1` or `0`, never touching an edge. They
 * compile, the checker rejects them, and they prove nothing - they fail on
 * every input, so they cannot show that the data defeats any particular
 * mistake.
 *
 * The validator is the reference for "how much input there is", because it is
 * the artefact that already reads the whole format. A wrong solution reading
 * less than half as much is not attempting the problem. The floor stops short
 * problems from being flagged on a rounding difference.
 */
export async function checkWrongSolutionSubstance(
  problemId: string,
  config: ProblemConfig,
): Promise<string[]> {
  if (config.wrongSolutions.length === 0) {
    return [];
  }

  let validatorReads: number;
  try {
    validatorReads = countInputReads(
      await fs.readFile(problemPath(problemId, config.validator), "utf8"),
    );
  } catch {
    return [];
  }
  // Too small to judge: with only a couple of values the ratio would be noise.
  if (validatorReads < 4) {
    return [];
  }

  const problems: string[] = [];
  for (const wrong of config.wrongSolutions) {
    if (wrong.language === "python" || !wrong.path.endsWith(".cpp")) {
      continue;
    }
    let reads: number;
    try {
      reads = countInputReads(await fs.readFile(problemPath(problemId, wrong.path), "utf8"));
    } catch {
      continue;
    }
    // A third of the reference is a generous bar: a real wrong algorithm reads
    // essentially the same input and then mishandles it. Measured on graph-004,
    // the validator reads 5 values while both wrong solutions read 1.
    if (reads * 3 >= validatorReads) {
      continue;
    }
    problems.push(
      [
        `### 错解 ${wrong.name} 没有真正读入题目输入`,
        "```",
        `validator 读入 ${validatorReads} 个值，而 ${wrong.path} 只读了 ${reads} 个`,
        "```",
        "这说明它没有实现一个具体的错误思路，而是把所有输入都忽略掉、直接输出一个常数。",
        "这种错解能编译、也会被判 WA，但**对任何数据都错**，",
        "因此无法证明数据能卡住任何一类真实的错误做法，观察价值为零。",
        "",
        "请二选一：",
        "- 改成一个**真的错误算法**：完整读入题面声明的全部输入，",
        "  然后在一个具体环节上出错（只枚举单点割、重边未累加、`int` 溢出、贪心取局部最优等）；",
        "- 或者**删掉这个错解**（连同 config.json 的 wrongSolutions 条目）。",
        "不写错解是完全允许的，比写一个占位错解更好。",
      ].join("\n"),
    );
  }
  return problems;
}

/** A repair-facing diagnostic for a first-line mismatch. */
export function describeFormatMismatch(mismatch: FormatMismatch): string {
  return [
    "### 题面声明的行格式 与 validator 实际要求的行数不一致",
    "```",
    `题面：${mismatch.sentence}`,
    "   -> 题面说这些值都在**同一行**",
    `validator 实际要求 ${mismatch.actualLines} 行（开头有 ${mismatch.actualLines} 个 readEoln）`,
    "```",
    "validator 比题面**更严格**：按题面格式（一行写完）提交的合法程序，",
    "会在第二个 `readEoln()` 处被拒绝。",
    "",
    "本地验题不会发现这个问题——generator 是按 validator 的口味造数据的，",
    "两者一致，所以测试全过，但题面对选手是错的。",
    "",
    "请以**题面为准**修正，并保持三处一致：",
    "- `validator.cpp`：题面说同一行的值就读成同一行（只在行尾一个 `readEoln()`）",
    "- `generator.cpp`：按同样行数输出",
    "- 两份标程：按同样的行数读入",
    "如果你认为题面的行格式写错了，请改题面，但要保证三处最终一致。",
  ].join("\n");
}
