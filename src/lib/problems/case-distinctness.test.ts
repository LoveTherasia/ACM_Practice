import { describe, expect, it } from "vitest";

import { checkCaseDistinctness } from "./case-distinctness";
import type { ProblemConfig } from "./schema";

/** A minimal valid config with the given cases. */
function configWith(cases: { type: string; seed: number }[]): ProblemConfig {
  return {
    slug: "test",
    title: "test",
    interactive: false,
    timeLimitMs: 2000,
    memoryLimitMb: 1024,
    standard: "gnu++20",
    statement: "docs/statement.md",
    tutorial: "docs/tutorial.md",
    validator: "src/validator/validator.cpp",
    generator: {
      path: "src/generator/generator.cpp",
      cases: cases.map((c, i) => ({
        name: `case-${i}`,
        type: c.type,
        seed: c.seed,
        group: "secret",
      })),
    },
    checker: "src/checker/checker.cpp",
    interactor: null,
    solutions: [],
    wrongSolutions: [],
  } as unknown as ProblemConfig;
}

/** A fake runner mapping "type#seed" to output text. */
function runnerWith(map: Record<string, string>) {
  return async (type: string, seed: number) => {
    const out = map[`${type}#${seed}`];
    return out === undefined ? null : { code: 0, stdout: out };
  };
}

describe("checkCaseDistinctness", () => {
  it("stays silent when all types produce distinct data", async () => {
    const config = configWith([
      { type: "sample", seed: 1 },
      { type: "boundary-min", seed: 1 },
      { type: "random", seed: 1 },
    ]);
    const run = runnerWith({
      "sample#1": "1\n",
      "boundary-min#1": "2\n",
      "random#1": "3\n",
    });
    expect(await checkCaseDistinctness("x/x", config, run)).toEqual([]);
  });

  it("flags cross-type collisions (the data-struct-005 bug)", async () => {
    // Every type falls into the same branch -> identical output.
    const config = configWith([
      { type: "sample", seed: 1 },
      { type: "boundary-min", seed: 1 },
      { type: "random", seed: 1 },
    ]);
    const run = runnerWith({
      "sample#1": "3\n1 3\n2 5\n1 4\n",
      "boundary-min#1": "3\n1 3\n2 5\n1 4\n",
      "random#1": "3\n1 3\n2 5\n1 4\n",
    });
    const problems = await checkCaseDistinctness("x/x", config, run);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("完全相同的数据");
    expect(problems[0]).toContain("atoi");
  });

  it("flags same-type seed collisions (seed ignored)", async () => {
    const config = configWith([
      { type: "random", seed: 1 },
      { type: "random", seed: 2 },
      { type: "random", seed: 3 },
    ]);
    const run = runnerWith({
      "random#1": "42\n",
      "random#2": "42\n",
      "random#3": "42\n",
    });
    const problems = await checkCaseDistinctness("x/x", config, run);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("忽略了 seed");
  });

  it("does not flag same-type seeds that differ", async () => {
    const config = configWith([
      { type: "random", seed: 1 },
      { type: "random", seed: 2 },
    ]);
    const run = runnerWith({
      "random#1": "42\n",
      "random#2": "43\n",
    });
    expect(await checkCaseDistinctness("x/x", config, run)).toEqual([]);
  });

  it("normalises CRLF so line-ending drift is not a phantom difference", async () => {
    const config = configWith([
      { type: "a", seed: 1 },
      { type: "b", seed: 1 },
    ]);
    const run = runnerWith({
      "a#1": "1\r\n2\r\n",
      "b#1": "1\n2\n",
    });
    // Same content after normalisation -> cross-type collision IS flagged
    // (they are genuinely identical data).
    const problems = await checkCaseDistinctness("x/x", config, run);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("完全相同的数据");
  });

  it("skips silently when the generator fails to run", async () => {
    const config = configWith([
      { type: "a", seed: 1 },
      { type: "b", seed: 1 },
    ]);
    const run = async () => null;
    expect(await checkCaseDistinctness("x/x", config, run)).toEqual([]);
  });

  it("stays silent for a single case", async () => {
    const config = configWith([{ type: "only", seed: 1 }]);
    const run = runnerWith({ "only#1": "1\n" });
    expect(await checkCaseDistinctness("x/x", config, run)).toEqual([]);
  });
});
