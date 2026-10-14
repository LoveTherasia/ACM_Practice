import { createHash } from "node:crypto";

import type { ProblemConfig } from "./schema";

/**
 * Case-distinctness preflight: every generator case type must produce
 * distinct data.
 *
 * data-struct-005 shipped a generator whose dispatch was NUMERIC
 * (`atoi(argv[1])`) while the config declared STRING types ("sample",
 * "boundary-min", ...). `atoi("sample")` is 0, so every one of the 33
 * declared cases fell into the type-0 branch and produced the IDENTICAL
 * input. Verification passed 33/33 - every case was valid - while the
 * entire test suite had the coverage of a single case. The repair rounds
 * "fixed" the solutions against that one input, and nothing anywhere
 * noticed, because no check compares cases to each other.
 *
 * This check runs the generator once per declared case (inside the sandbox)
 * and hashes the output. Two failure modes are reported:
 *
 * 1. CROSS-TYPE COLLISION: two different case types produce identical
 *    data. This is almost always a dispatch bug (numeric vs string type,
 *    a typo'd branch, a fall-through) and means the named coverage
 *    (boundary, degenerate, anti-*) does not exist. Reported as an error.
 *
 * 2. SAME-TYPE SEED COLLISION: one type with multiple seeds produces
 *    identical data for different seeds. The generator ignores the seed
 *    for that branch - the "different seeds" in the config are fake
 *    diversity. Reported as a warning (the data may still be valid, but
 *    the case list overstates its coverage).
 *
 * Generators that fail to compile or run are skipped silently: the compile
 * preflight and the verifier report those with better context.
 */

/** One representative (type, seed) per distinct type, plus all seeds. */
type CaseProbe = { type: string; seed: number };

export type DistinctnessResult = {
  /** Cross-type collisions: distinct types with identical output. */
  crossTypeCollisions: { types: string[]; hash: string }[];
  /** Same-type seed collisions: one type, multiple seeds, identical output. */
  seedCollisions: { type: string; seeds: number[] }[];
  /** How many cases were actually probed (compile/run failures skip). */
  probed: number;
};

export async function checkCaseDistinctness(
  problemId: string,
  config: ProblemConfig,
  runGenerator: (
    type: string,
    seed: number,
  ) => Promise<{ code: number; stdout: string } | null>,
): Promise<string[]> {
  const cases = config.generator.cases;
  if (cases.length < 2) {
    return []; // A single case cannot collide with anything.
  }

  // Probe every (type, seed) pair declared in the config. Deduplicate
  // identical pairs (some configs repeat a case name).
  const seen = new Set<string>();
  const probes: CaseProbe[] = [];
  for (const c of cases) {
    const key = `${c.type}#${c.seed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    probes.push({ type: c.type, seed: c.seed });
  }

  // Run the generator for each probe and hash the output.
  const outputs = new Map<string, string>(); // "type#seed" -> hash
  const hashToTypes = new Map<string, Set<string>>();
  const typeToHashes = new Map<string, Map<string, number[]>>(); // type -> hash -> seeds

  let probed = 0;
  for (const probe of probes) {
    const result = await runGenerator(probe.type, probe.seed);
    if (!result || result.code !== 0) {
      continue; // Compile/run failures are reported elsewhere.
    }
    probed += 1;
    // Hash the full output, normalising line endings so a CRLF/LF mix in
    // the generator's println does not create phantom differences.
    const normalized = result.stdout.replace(/\r\n/g, "\n");
    const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
    outputs.set(`${probe.type}#${probe.seed}`, hash);

    const types = hashToTypes.get(hash) ?? new Set<string>();
    types.add(probe.type);
    hashToTypes.set(hash, types);

    const seeds = typeToHashes.get(probe.type) ?? new Map<string, number[]>();
    const list = seeds.get(hash) ?? [];
    list.push(probe.seed);
    seeds.set(hash, list);
    typeToHashes.set(probe.type, seeds);
  }

  if (probed < 2) {
    return []; // Not enough runnable cases to compare.
  }

  const problems: string[] = [];

  // 1. Cross-type collisions.
  const crossType: { types: string[]; hash: string }[] = [];
  for (const [hash, types] of hashToTypes) {
    if (types.size > 1) {
      crossType.push({ types: [...types].sort(), hash });
    }
  }
  if (crossType.length > 0) {
    const lines = crossType.map(
      (c) => `- ${c.types.join("、")}（输出哈希 ${c.hash}）`,
    );
    problems.push(
      [
        "### 多个 case type 生成了完全相同的数据",
        "```",
        ...lines,
        "```",
        `共 ${probed} 个 case 中有 ${crossType.reduce((s, c) => s + c.types.length, 0)} 个 type 的输出彼此相同。`,
        "",
        "这几乎总是 generator 的 type 分发 bug：最常见的原因是",
        "generator 用 `atoi(argv[1])` 读取数字 type，而 config 声明的是字符串 type",
        "（`atoi(\"sample\")` 恒为 0，所有 case 都落到第一个分支）；",
        "也可能是分支名拼写错误或缺少 break 导致的 fall-through。",
        "",
        "**后果**：验题会全部通过（每个 case 的数据本身合法），",
        "但整个测试集的覆盖等于单个 case——config 里声明的边界、退化、",
        "对抗数据实际上一个都不存在，题目的数据强度远低于声称的水平。",
        "",
        "请检查 `generator.cpp` 的 type 分发：",
        "- 用 `string type = argv[1]` 并逐字符串比较，与 config 的 type 声明严格对齐；",
        "- 确认每个分支真的构造了该 type 名所描述的数据形态；",
        "- 修复后重跑验题，确认各 type 的输出不再相同。",
      ].join("\n"),
    );
  }

  // 2. Same-type seed collisions (weaker signal, reported separately).
  const seedCollisions: { type: string; seeds: number[] }[] = [];
  for (const [type, seeds] of typeToHashes) {
    const multi = [...seeds.entries()].filter(([, list]) => list.length > 1);
    if (multi.length > 0 && seeds.size === 1 && probes.filter((p) => p.type === type).length > 1) {
      // All seeds of this type produced the same output.
      const allSeeds = probes.filter((p) => p.type === type).map((p) => p.seed);
      seedCollisions.push({ type, seeds: allSeeds });
    }
  }
  if (seedCollisions.length > 0) {
    const lines = seedCollisions.map(
      (c) => `- \`${c.type}\`：seed ${c.seeds.join("、")} 的输出完全相同`,
    );
    problems.push(
      [
        "### 部分 case type 忽略了 seed，多 seed 是虚假多样性",
        "```",
        ...lines,
        "```",
        "config 为这些 type 声明了多个 seed，但 generator 的对应分支没有使用",
        "`rnd`（或没有以 seed 初始化），导致不同 seed 产出相同数据。",
        "",
        "数据本身仍然合法（验题不会失败），但 case 清单声称的覆盖",
        "（\"不同 seed 的多份随机数据\"）并不存在。",
        "",
        "请让这些分支真正使用 `rnd.setSeed(seed)` 之后的随机源，",
        "或者减少该 type 的 seed 数量、把预算花在真正不同的数据形态上。",
      ].join("\n"),
    );
  }

  return problems;
}
