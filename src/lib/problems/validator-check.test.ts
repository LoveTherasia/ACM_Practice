import { describe, expect, it } from "vitest";

import { checkValidatorAcceptsGenerator } from "./validator-check";
import type { ProblemConfig } from "./schema";

function configWith(cases: { name: string; type: string; seed: number }[]): ProblemConfig {
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
      cases: cases.map((c) => ({ ...c, group: "secret" })),
    },
    checker: "src/checker/checker.cpp",
    interactor: null,
    solutions: [],
    wrongSolutions: [],
  } as unknown as ProblemConfig;
}

const threeCases = [
  { name: "sample-1", type: "sample", seed: 1 },
  { name: "sample-2", type: "sample", seed: 2 },
  { name: "boundary-min-1", type: "boundary-min", seed: 1 },
];

describe("checkValidatorAcceptsGenerator", () => {
  it("is silent when the validator accepts every generated case", async () => {
    const gen = async () => ({ code: 0, stdout: "1 2\n" });
    const val = async () => ({ code: 0, stderr: "", timedOut: false });
    expect(await checkValidatorAcceptsGenerator("x/x", configWith(threeCases), gen, val)).toEqual([]);
  });

  it("reports the first case the validator rejects", async () => {
    let genCall = 0;
    let valCall = 0;
    const gen = async () => {
      genCall += 1;
      return { code: 0, stdout: `line-${genCall}\n` };
    };
    const val = async (input: string) => {
      valCall += 1;
      // Reject on the second case only.
      return valCall === 2
        ? { code: 3, stderr: "FAIL edge 4: expected u_i < v_i, got 4 1", timedOut: false }
        : { code: 0, stderr: "", timedOut: false };
    };
    const problems = await checkValidatorAcceptsGenerator("x/x", configWith(threeCases), gen, val);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("validator 拒绝了 generator 产出的数据");
    expect(problems[0]).toContain("case：sample-2");
    expect(problems[0]).toContain("validator 退出码：3");
    expect(problems[0]).toContain("expected u_i < v_i");
    expect(problems[0]).toContain("generator 输出");
    // Stops at the first rejection rather than testing the third case.
    expect(genCall).toBe(2);
  });

  it("reports a generator that cannot produce a declared case", async () => {
    const gen = async (type: string) =>
      type === "boundary-min" ? null : { code: 0, stdout: "1\n" };
    const val = async () => ({ code: 0, stderr: "", timedOut: false });
    const problems = await checkValidatorAcceptsGenerator("x/x", configWith(threeCases), gen, val);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("generator 无法为声明的 case 产出数据");
    expect(problems[0]).toContain("boundary-min-1");
  });

  it("skips cases whose validator could not be run", async () => {
    const gen = async () => ({ code: 0, stdout: "1\n" });
    const val = async () => null;
    expect(await checkValidatorAcceptsGenerator("x/x", configWith(threeCases), gen, val)).toEqual([]);
  });

  it("stops at the first rejection even when every case is rejected", async () => {
    const gen = async () => ({ code: 0, stdout: "1\n" });
    const val = async () => ({ code: 3, stderr: "FAIL", timedOut: false });
    const problems = await checkValidatorAcceptsGenerator("x/x", configWith(threeCases), gen, val);
    expect(problems).toHaveLength(1);
  });

  it("stays silent when the config plans no cases", async () => {
    const gen = async () => ({ code: 0, stdout: "" });
    const val = async () => ({ code: 3, stderr: "FAIL", timedOut: false });
    expect(await checkValidatorAcceptsGenerator("x/x", configWith([]), gen, val)).toEqual([]);
  });

  it("truncates a huge generator output in the report", async () => {
    const gen = async () => ({ code: 0, stdout: "x".repeat(5000) });
    const val = async () => ({ code: 3, stderr: "FAIL", timedOut: false });
    const problems = await checkValidatorAcceptsGenerator("x/x", configWith([threeCases[0]!]), gen, val);
    expect(problems[0]).toContain("已截断");
  });
});
