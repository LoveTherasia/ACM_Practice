import type { GeneratorCase, ProblemConfig } from "@/lib/problems/schema";

/**
 * Data-coverage audit.
 *
 * The pipeline's data strategy is deliberately NOT "enumerate wrong solutions,
 * then derive data from them" - that never converged, because each generation
 * produced a different set of wrong solutions and the data drifted with it.
 * The strategy is instead to plan for broad, declared coverage up front and use
 * two independent reference solutions as the cross-check that catches whatever
 * nobody thought of.
 *
 * That only works if the plan is actually honoured, so this module reads the
 * case list back and reports where it is thin. It is advisory by design: it
 * never edits a workspace and never fails a verification on its own, because
 * "this data could be stronger" is a judgement call, not a test result.
 *
 * Classification is substring-based rather than a fixed list of type names.
 * Real workspaces contain 167 distinct type names for 439 cases - the model
 * invents names freely - so a closed list would misclassify most of them. The
 * `coverage` field the architect now writes is the reliable signal; the name
 * matching is a fallback for workspaces generated before that field existed.
 */

export type CoverageGap = {
  /** A short stable identifier, useful for grouping repeated complaints. */
  kind: string;
  message: string;
};

export type CoverageReport = {
  total: number;
  /** Cases the architect explicitly marked for cross-checking. */
  crossChecked: number;
  /**
   * Cases whose intent could not be read from name or coverage note. Non-zero
   * means the bucket counts are a lower bound, not a measurement.
   */
  unclassified: number;
  counts: {
    sample: number;
    boundary: number;
    large: number;
    structural: number;
    random: number;
  };
  gaps: CoverageGap[];
};

/*
 * Classification strategy, and its limits.
 *
 * The `coverage` field the architect now writes is the reliable signal. Name
 * matching is a fallback for workspaces generated before that field existed,
 * and it is deliberately rough: measured against the 13 real workspaces, 52 of
 * 439 cases match no bucket at all (names like "broom", "caterpillar",
 * "fft-tie", "anti-greedy"). Those are almost always legitimate structural or
 * adversarial cases whose intent is simply not guessable from a name.
 *
 * So this module never claims a workspace is well covered. It reports what it
 * can prove and raises the missing-intent gap when it cannot see the intent -
 * the honest reading of an unclassified case is "unknown", not "absent".
 */

/** Matched only as a whole word, so "max-component" is not read as a bound. */
const BOUND_WORD = /(?:^|[^a-z])(min|max)(?:[^a-z]|$)/i;

/** A case is any of these when its name or intent mentions the concept. */
const PATTERNS = {
  sample: /sample|样例/i,
  boundary: /boundary|lower-?bound|upper-?bound|下界|上界|边界/i,
  large: /large|big|huge|dense|tle|上界规模|大规模|时限|极限/i,
  structural:
    /chain|star|broom|caterpillar|tree|forest|complete|clique|bipartite|cycle|path|sparse|degenerate|equal|same|sorted|reverse|duplicate|empty|isolated|single|nosolution|no-solution|infeasible|negative|two-values|all-|anti-|链|星|树|完全|二分|环|退化|重复|逆序|有序|孤立|空|无解/i,
  random: /random|rand|均匀|随机/i,
} as const;

function bucketFor(item: GeneratorCase): (keyof typeof PATTERNS)[] {
  const hay = `${item.type} ${item.name} ${item.coverage}`;
  const hits = (Object.keys(PATTERNS) as (keyof typeof PATTERNS)[]).filter(
    (key) => PATTERNS[key].test(hay),
  );
  // "min"/"max" are only boundary evidence as standalone tokens. A name like
  // "max-component" is a large structural case, not a range bound.
  if (BOUND_WORD.test(`${item.type} ${item.name}`)) {
    hits.push("boundary");
  }
  return [...new Set(hits)];
}

/**
 * Case counts by dimension, for the given cases.
 *
 * Split out from auditCoverage so it can be measured against the real
 * workspaces without constructing a full validated config.
 */
export function countCoverage(cases: GeneratorCase[]) {
  const buckets = cases.map(bucketFor);
  return {
    counts: {
      sample: buckets.filter((b) => b.includes("sample")).length,
      boundary: buckets.filter((b) => b.includes("boundary")).length,
      large: buckets.filter((b) => b.includes("large")).length,
      structural: buckets.filter((b) => b.includes("structural")).length,
      random: buckets.filter((b) => b.includes("random")).length,
    },
    unclassified: buckets.filter((b) => b.length === 0).length,
  };
}

/** Cases the verifier is told to run a second reference solution against. */
function isCrossChecked(item: GeneratorCase): boolean {
  return (item.checkWith?.length ?? 0) > 0;
}

export function auditCoverage(config: ProblemConfig): CoverageReport {
  const cases = config.generator.cases;
  const { counts, unclassified } = countCoverage(cases);
  const crossChecked = cases.filter(isCrossChecked).length;

  const gaps: CoverageGap[] = [];
  const push = (kind: string, message: string) => gaps.push({ kind, message });

  if (cases.length < 30) {
    push(
      "too-few-cases",
      `只有 ${cases.length} 个测试点，少于约定下限 30 个。`,
    );
  }
  if (counts.sample === 0) {
    push("no-sample", "没有任何 group=sample 的样例点，题面的样例没有对应的测试点。");
  }
  if (counts.boundary === 0) {
    push(
      "no-boundary",
      "没有任何边界 / 退化点。这是数据强度最关键的一档：下界、上界与 off-by-one 全靠它。",
    );
  }
  if (counts.large === 0) {
    push(
      "no-large",
      "没有任何上界规模的点，无法卡时限、卡常数、卡栈深度，复杂度达标的解法不会被惩罚。",
    );
  }
  if (counts.random === 0) {
    push(
      "no-random",
      "没有任何随机的点。随机数据是唯一不依赖猜测的防线，缺了它就没法对拍兜住预想之外的错误。",
    );
  }
  if (counts.structural === 0) {
    push(
      "no-structural",
      "没有任何极端结构点（链、星、完全图、全相同、逆序等）。同一规模下结构不同会打掉完全不同的做法。",
    );
  }
  if (crossChecked === 0) {
    push(
      "no-cross-check",
      "没有任何 case 指定 checkWith，两份正解不会被交叉验证，对拍这一层防线实际没有生效。",
    );
  } else if (crossChecked < 5) {
    push(
      "thin-cross-check",
      `只有 ${crossChecked} 个点参与交叉验证，对拍的样本太少，建议小规模随机点都加上 checkWith。`,
    );
  }

  const missingIntent = cases.filter((c) => c.coverage.trim() === "").length;
  if (missingIntent === cases.length && cases.length > 0) {
    push(
      "no-coverage-intent",
      "所有 case 都没有 coverage 说明，上面的分类只能靠名字猜，数字偏保守也不可靠；" +
        "这批数据可能产生于该字段引入之前。",
    );
  } else if (missingIntent > 0) {
    push(
      "partial-coverage-intent",
      `有 ${missingIntent}/${cases.length} 个 case 没有 coverage 说明，其中可能混着名不副实的点。`,
    );
  }

  // Naming is not intent: report the residue rather than folding it into a
  // bucket, so an inflated "looks covered" reading is impossible.
  if (unclassified > 0 && missingIntent > 0) {
    push(
      "unclassified-cases",
      `有 ${unclassified}/${cases.length} 个 case 无法从名字判断意图（如 broom、caterpillar、fft-tie 这类自造名）。` +
        `它们可能是有效的结构或定向数据，但审计无法确认，请人工核对。`,
    );
  }

  // A large batch of same-distribution random points reads as thorough while
  // covering very little; flag the imbalance rather than the raw count.
  if (counts.random > 0 && counts.random >= cases.length / 2 && counts.boundary === 0) {
    push(
      "random-dominated",
      `随机点占了一半以上（${counts.random}/${cases.length}）却没有任何边界点，` +
        `这是典型的"体量看起来够、强度其实很弱"。`,
    );
  }

  return { total: cases.length, crossChecked, unclassified, counts, gaps };
}

/** Human-readable one-line summary, for the pipeline log. */
export function summarizeCoverage(report: CoverageReport): string {
  const { total, counts, crossChecked, unclassified } = report;
  const unknown =
    unclassified > 0 ? `，意图不明 ${unclassified}（计数为下限）` : "";
  return (
    `数据覆盖：共 ${total} 点（边界 ${counts.boundary} / 规模 ${counts.large} / ` +
    `结构 ${counts.structural} / 随机 ${counts.random} / 样例 ${counts.sample}），` +
    `交叉验证 ${crossChecked} 点${unknown}`
  );
}

/**
 * The coverage report as verifier-transcript lines.
 *
 * Written into the transcript rather than only into the pipeline's SSE log, so
 * it survives in verify-logs/ and is visible wherever a verification result is
 * read - including a plain "重新验题" click, which never runs the generation
 * pipeline and so would otherwise show a pass with no hint about data strength.
 */
export function formatCoverageForLog(report: CoverageReport): string[] {
  return [
    summarizeCoverage(report),
    ...(report.gaps.length > 0
      ? report.gaps.map((gap) => `数据覆盖提示（${gap.kind}）：${gap.message}`)
      : // Say so explicitly. A silent audit and a passing audit look identical
        // otherwise, and the reader cannot tell whether it ran at all.
        [
          "数据覆盖提示：基本覆盖门槛全部满足（样例、边界、规模、结构、随机、交叉验证均有覆盖）。" +
            "这不等于数据已经没有空洞——意图未标注的点仍需人工确认。",
        ]),
  ];
}
