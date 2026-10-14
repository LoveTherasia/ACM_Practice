import { describe, expect, it } from "vitest";

import { generatorTypeIssues, parseImplementedTypes } from "./format";
import type { ProblemConfig } from "./schema";

/** A minimal valid config planning the given case types. */
function configWith(types: string[]): ProblemConfig {
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
      cases: types.map((type, i) => ({
        name: `case-${i}`,
        type,
        seed: 1,
        group: "secret",
      })),
    },
    checker: "src/checker/checker.cpp",
    interactor: null,
    solutions: [],
    wrongSolutions: [],
  } as unknown as ProblemConfig;
}

/** The scaffold template: 5 branches, no SUPPORTED_TYPES marker, explicit reject. */
const TEMPLATE = `
#include "testlib.h"
int main(int argc, char* argv[]) {
    std::string type = argv[1];
    long long n = 0;
    if (type == "sample") { n = 5; }
    else if (type == "min") { n = 0; }
    else if (type == "random-small") { n = 1; }
    else if (type == "random-large") { n = 2; }
    else if (type == "max") { n = 3; }
    else { cerr << "Unknown case type: " << type << '\\n'; return 2; }
    cout << n << '\\n';
}
`;

describe("parseImplementedTypes", () => {
  it("reads literal type == comparisons", () => {
    const found = parseImplementedTypes(TEMPLATE);
    expect([...found].sort()).toEqual(["max", "min", "random-large", "random-small", "sample"]);
  });

  it("reads the reversed comparison form", () => {
    expect(parseImplementedTypes(`if ("sorted" == type) {}`).has("sorted")).toBe(true);
  });

  it("ignores names that are not compared to type", () => {
    expect(parseImplementedTypes(`void f(){ std::string x = "hello"; }`).size).toBe(0);
  });
});

describe("generatorTypeIssues", () => {
  it("flags the scaffold template against a plan it does not implement (graph-005/greedy-008)", () => {
    const config = configWith(["boundary-min", "empty-query", "anti-tle", "sample"]);
    const problems = generatorTypeIssues(TEMPLATE, config);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("没有实现");
    expect(problems[0]).toContain("boundary-min");
    // The report names both what was planned and what was really implemented.
    expect(problems[0]).toContain("实际实现的分支");
    expect(problems[0]).toContain("缺失");
  });

  it("is silent when literal branches cover every planned type", () => {
    const source = `if (type == "a") {} else if (type == "b") {} else { quitf(_fail, "Unknown case type"); }`;
    expect(generatorTypeIssues(source, configWith(["a", "b", "a"]))).toEqual([]);
  });

  it("uses the SUPPORTED_TYPES declaration when dispatch has no literal branches", () => {
    const source = `// SUPPORTED_TYPES: sample, boundary-min\nstd::map<std::string,int> tbl;\nelse quitf(_fail, "Unknown case type");`;
    expect(generatorTypeIssues(source, configWith(["sample", "boundary-min"]))).toEqual([]);
  });

  it("unions the declaration and the branches", () => {
    // "fallback-type" is only declared; "sample" is only branched on.
    const source = `// SUPPORTED_TYPES: sample, fallback-type\nif (type == "sample") {} else quitf(_fail, "Unknown case type");`;
    expect(generatorTypeIssues(source, configWith(["sample", "fallback-type"]))).toEqual([]);
  });

  it("flags a declared type the config never plans only when the config asks for a type it lacks", () => {
    const source = `// SUPPORTED_TYPES: a\nif (type == "a") { quitf(_fail, "Unknown case type"); }`;
    const problems = generatorTypeIssues(source, configWith(["a", "b"]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("缺失：b");
  });

  it("still flags a declared generator with no rejection path", () => {
    const source = `// SUPPORTED_TYPES: a\nif (type == "a") {} else { /* silent default */ }`;
    const problems = generatorTypeIssues(source, configWith(["a"]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("没有显式拒绝未知 type");
  });

  it("does not require a rejection path when there is no declaration", () => {
    const source = `if (type == "a") {} else if (type == "b") {}`;
    expect(generatorTypeIssues(source, configWith(["a", "b"]))).toEqual([]);
  });

  it("stays silent when neither a declaration nor any branch can be read", () => {
    expect(generatorTypeIssues(`int main() { return 0; }`, configWith(["a"]))).toEqual([]);
  });

  it("stays silent when the config plans no cases", () => {
    expect(generatorTypeIssues(TEMPLATE, configWith([]))).toEqual([]);
  });
});
