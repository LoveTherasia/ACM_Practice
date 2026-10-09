import { z } from "zod";

/**
 * The problem workspace contract.
 *
 * This mirrors config.json from the vendored icpc-problem-creator skill, which
 * is the single source of truth that drives scripts/run-all-tests.ps1. The
 * schemas below are deliberately structural: we validate shape so the console
 * can render a workspace and the pipeline can round-trip a config, but we do
 * not re-argue the skill's semantic rules (case reproducibility, checker vs
 * interactor exclusivity, case coverage). Those stay owned by the skill and are
 * checked by the verifier.
 */

export const generatorCaseSchema = z.object({
  name: z.string().min(1),
  /** argv[1] handed to the generator binary. */
  type: z.string().min(1),
  /** argv[2]. Every case must be reproducible from type + seed. */
  seed: z.number().int(),
  group: z.string().min(1).default("secret"),
  /** Restrict this case to a subset of reference solutions. */
  checkWith: z.array(z.string().min(1)).optional(),
  /**
   * What dimension of the data this case covers, e.g. "所有点权相同、n 取上界".
   *
   * This is the app's own field, not the skill's: the verifier ignores unknown
   * keys, so it rides along in config.json harmlessly. It exists because the
   * data plan is the thing that decides whether a problem is well covered -
   * without a recorded intent, a case list degenerates into a pile of similar
   * random data, and neither the generator prompt nor the coverage audit can
   * tell "boundary-max" apart from a mislabelled random case.
   */
  coverage: z.string().default(""),
});

export const buildSchema = z.object({
  cppCompiler: z.string().min(1).default("g++"),
  cppFlags: z.array(z.string()).optional(),
  pythonCommand: z.string().min(1).default("python"),
  /** Overrides the default compile invocation for a single file. */
  compileCommand: z.string().optional(),
});

export const solutionSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  language: z.enum(["cpp", "python"]).default("cpp"),
  role: z.enum(["main", "reference"]).default("reference"),
});

export const wrongSolutionSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  language: z.enum(["cpp", "python"]).default("cpp"),
  expected: z.enum(["fail", "pass", "observe"]).default("fail"),
  /** Restrict which cases this wrong solution is run against. */
  cases: z.array(z.string()).optional(),
  groups: z.array(z.string()).optional(),
});

export const problemConfigSchema = z
  .object({
    slug: z.string().min(1),
    title: z.string().min(1),
    interactive: z.boolean().default(false),
    timeLimitMs: z.number().int().positive().default(2000),
    memoryLimitMb: z.number().int().positive().default(1024),
    standard: z.string().min(1).default("gnu++20"),
    statement: z.string().min(1),
    tutorial: z.string().min(1),
    validator: z.string().min(1),
    generator: z.object({
      path: z.string().min(1),
      cases: z.array(generatorCaseSchema),
    }),
    checker: z.string().nullable().optional(),
    interactor: z.string().nullable().optional(),
    build: buildSchema.optional(),
    solutions: z.array(solutionSchema).default([]),
    wrongSolutions: z.array(wrongSolutionSchema).default([]),
  })
  // Standard problems use a checker, interactive problems use an interactor.
  // Exactly one of the two, never both and never neither.
  .refine((cfg) => Boolean(cfg.checker) !== Boolean(cfg.interactor), {
    message: "checker 与 interactor 必须且只能存在一个",
    path: ["checker"],
  });

export type ProblemConfig = z.infer<typeof problemConfigSchema>;
export type GeneratorCase = z.infer<typeof generatorCaseSchema>;
export type SolutionEntry = z.infer<typeof solutionSchema>;
export type WrongSolutionEntry = z.infer<typeof wrongSolutionSchema>;

/* ---------------------------------------------------------------------------
   Pipeline metadata
   ---------------------------------------------------------------------------
   Everything above is the skill's contract. Everything below is ours: the extra
   fields the app needs to show a problem in the console without re-reading
   generated sources. They live in a sibling file (meta.json) so config.json
   stays byte-compatible with the verifier.
   ------------------------------------------------------------------------ */

export const difficultySchema = z.enum(["简单", "中档", "困难"]);

export const verificationSchema = z.object({
  /** ISO timestamp of the last verifier run. */
  ranAt: z.string(),
  passed: z.boolean(),
  /** Case counts reported by run-all-tests.ps1. */
  totalCases: z.number().int().nonnegative().default(0),
  passedCases: z.number().int().nonnegative().default(0),
  /** Path to the raw log under .codex-test-artifacts/logs/. */
  logPath: z.string().nullable().default(null),
  /** Short failure digest shown in the console. */
  failures: z
    .array(z.object({ scope: z.string(), message: z.string() }))
    .default([]),
});

export const problemMetaSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  difficulty: difficultySchema.default("中档"),
  /** Free-form tags, e.g. "图论", "构造", "交互". */
  tags: z.array(z.string()).default([]),
  /** The idea the architect started from. */
  premise: z.string().default(""),
  /** The intended solution direction, recorded for the tutorial. */
  expectedApproach: z.string().default(""),
  complexity: z.string().default(""),
  /** Exact input format contract shared by all parallel roles. */
  inputFormat: z.string().default(""),
  /** Exact output format contract shared by all parallel roles. */
  outputFormat: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
  verification: verificationSchema.nullable().default(null),
  /** True once a user submission has passed every test case. */
  solved: z.boolean().default(false),
});

export type Difficulty = z.infer<typeof difficultySchema>;
export type Verification = z.infer<typeof verificationSchema>;
export type ProblemMeta = z.infer<typeof problemMetaSchema>;

/* ---------------------------------------------------------------------------
   Pipeline run log
   ------------------------------------------------------------------------ */

/**
 * The roles the pipeline actually runs.
 *
 * There used to be a fourth worker, "wrong-gen", whose job was to enumerate
 * wrong solutions first and then derive targeted data from them. That approach
 * never converged - each generation produced a different set of wrong
 * solutions, so the data itself was unstable - and it was replaced by planning
 * for broad data coverage up front (see the architect and judge-validator
 * prompts). The role is gone from the union rather than left as a dead member:
 * an unused variant invites code that waits for a stage that never runs.
 *
 * Wrong solutions can still appear in a config (the verifier runs them in
 * "observe" mode and reports which cases they fail), but no stage owns writing
 * them, because they are not what the data plan is derived from.
 */
export const pipelineRoleSchema = z.enum([
  "architect",
  "judge-validator",
  "solutions-tutorial",
  "integrator",
  "verifier",
]);

export type PipelineRole = z.infer<typeof pipelineRoleSchema>;

export const stageStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "failed",
  "skipped",
]);

export type StageStatus = z.infer<typeof stageStatusSchema>;

export const pipelineStageSchema = z.object({
  role: pipelineRoleSchema,
  title: z.string(),
  status: stageStatusSchema,
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** Files the role was told to write, workspace relative. */
  wrote: z.array(z.string()).default([]),
  /** Short human readable summary for the console. */
  summary: z.string().default(""),
  error: z.string().nullable().default(null),
});

export type PipelineStage = z.infer<typeof pipelineStageSchema>;

export const pipelineRunSchema = z.object({
  id: z.string(),
  slug: z.string(),
  premise: z.string(),
  difficulty: difficultySchema,
  interactive: z.boolean(),
  stages: z.array(pipelineStageSchema),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.enum(["running", "done", "failed"]),
});

export type PipelineRun = z.infer<typeof pipelineRunSchema>;