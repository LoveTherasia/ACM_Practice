import type { PipelineRole } from "@/lib/problems/schema";

/**
 * The pipeline's stage list, as data.
 *
 * This lives outside the orchestrator so the landing page hero and the live
 * generate page describe the same pipeline from one source. A preview that
 * restates the steps by hand drifts within a week.
 */

export type StageDefinition = {
  role: PipelineRole;
  /** Chinese title, shown in the console and on the landing page. */
  title: string;
  /** Role identifier as it appears in the config and prompts. */
  roleKey: string;
  /** One line on what this stage is responsible for. */
  summary: string;
  /** Files this stage is responsible for. */
  targets: string[];
};

export const STAGES: StageDefinition[] = [
  {
    role: "architect",
    title: "定架构与题面",
    roleKey: "architect",
    summary: "确定核心机制、难度、数据范围与 case 规划，写出题面。",
    targets: ["config.json", "docs/statement.md"],
  },
  {
    role: "judge-validator",
    title: "judge 与数据",
    roleKey: "judge-validator",
    summary: "写 checker、validator 与 generator，三者格式严格对齐。",
    targets: ["src/checker/*.cpp", "src/validator/validator.cpp", "src/generator/generator.cpp"],
  },
  {
    role: "solutions-tutorial",
    title: "标程与题解",
    roleKey: "solutions-tutorial",
    summary: "写出两份独立的正确实现，以及难度匹配的题解。",
    targets: ["src/solution.cpp", "src/solution2.cpp", "docs/tutorial.md"],
  },
  {
    role: "integrator",
    title: "整体一致性审查",
    roleKey: "integrator",
    summary: "逐项核对题面、题解、代码与 config 是否互相自洽。",
    targets: ["config.json", "docs/*.md"],
  },
  {
    role: "verifier",
    title: "本地验题",
    roleKey: "verifier",
    summary: "调用 run-all-tests.ps1，编译、造数据、跑标程。",
    targets: [".codex-test-artifacts/logs/"],
  },
];

export const STAGE_TITLES: Record<PipelineRole, string> = STAGES.reduce(
  (acc, stage) => {
    acc[stage.role] = stage.title;
    return acc;
  },
  {} as Record<PipelineRole, string>,
);

/** The roles that run as a genuine parallel fan-out. */
export const PARALLEL_ROLES: PipelineRole[] = STAGES.filter((s) =>
  ["judge-validator", "solutions-tutorial"].includes(s.role),
).map((s) => s.role);