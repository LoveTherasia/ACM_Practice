import { promises as fs } from "node:fs";

import { architectModel, complete, LlmError, workerModel } from "@/lib/llm/provider";
import {
  architectSystem,
  architectUser,
  FILE_BLOCK_CLOSE,
  FILE_BLOCK_OPEN,
  integratorSystem,
  judgeValidatorSystem,
  solutionsTutorialSystem,
  workerUser,
  type PipelineBrief,
} from "@/lib/llm/prompts";
import { problemDir, isValidCategory } from "@/lib/paths";
import {
  difficultySchema,
  problemConfigSchema,
  problemMetaSchema,
  type PipelineRole,
  type PipelineRun,
  type PipelineStage,
  type ProblemConfig,
  type ProblemMeta,
} from "@/lib/problems/schema";
import { patchMeta, writeMeta } from "@/lib/problems/store";
import { allocateProblem, recordProblem } from "@/lib/problems/category";
import { captureSample } from "@/lib/training/dataset";
import {
  createWorkspace,
  dropMissingSolutionEntries,
  type GeneratedFile,
  preflightCompile,
  verificationEnabled,
  verifyWorkspace,
  writeGeneratedFiles,
} from "@/lib/problems/workspace";
import { auditCoverage, summarizeCoverage } from "@/lib/problems/coverage";

/**
 * The generation pipeline.
 *
 * Stage order follows the skill's own orchestration contract: the architect
 * fixes the architecture and scaffolds the workspace first, the three workers
 * run as a genuine parallel fan-out because none of them may read another one's
 * output, and the integrator reconciles whatever the fan-out produced before
 * the verifier gets a vote.
 */

export type PipelineEvent =
  | { type: "stage"; run: PipelineRun }
  | { type: "log"; runId: string; role: PipelineRole; message: string }
  | { type: "done"; run: PipelineRun }
  | { type: "error"; runId: string; message: string };

type Emit = (event: PipelineEvent) => void;

const BLOCK_PATTERN = /<<<FILE\s+([^\s>]+)\s*>>>\r?\n([\s\S]*?)\r?\n?<<<END>>>/g;
/**
 * A trailing block whose END marker was cut off by max_tokens.
 *
 * Content is `[\s\S]*` (not `+`) because the cut can land immediately after the
 * header, which is exactly the case that produced 0-byte source files.
 *
 * Deliberately unanchored at the end: the caller slices from the LAST header,
 * so anchoring is unnecessary, and a `$` here fails to match at all unless the
 * string happens to end in a newline (`$` only matches true end-of-input
 * without the `m` flag, and does not tolerate a trailing newline either).
 */
const OPEN_BLOCK_PATTERN = /<<<FILE\s+([^\s>]+)\s*>>>\r?\n([\s\S]*)/;

/** Pull every well-formed file block out of a model response. */
export function parseFileBlocks(text: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  for (const match of text.matchAll(BLOCK_PATTERN)) {
    const target = match[1]?.trim();
    if (!target) {
      continue;
    }
    files.push({ path: target, content: match[2] ?? "" });
  }

  // Salvage a trailing block whose END marker was cut off by max_tokens.
  //
  // This must run even when other blocks parsed fine: a reply with three
  // complete files and a fourth truncated one used to drop the fourth
  // silently, because only the `files.length === 0` case was handled. The
  // recovered content may be partial - the integrator and the repair loop can
  // complete it - but a dropped file leaves the scaffold template in place and
  // fails every case.
  //
  // When the cut happened right after the `<<<FILE x>>>` header this yields
  // blank content; writeGeneratedFiles refuses to overwrite an existing file
  // with it, so the file is reported as a failure instead of being truncated.
  const tail = text.slice(text.lastIndexOf("<<<FILE"));
  const open = tail.match(OPEN_BLOCK_PATTERN);
  if (open?.[1]) {
    const target = open[1].trim();
    if (target && !files.some((file) => file.path === target)) {
      files.push({ path: target, content: open[2] ?? "" });
    }
  }

  return files;
}

/** Tolerate a fenced block the model wrapped around the protocol example. */
function unwrapFence(text: string): string {
  return text.replace(/^```(?:[a-z]*)\n([\s\S]*?)\n?```$/gm, "$1");
}

function stripFencesFor(block: GeneratedFile): GeneratedFile {
  if (block.path.endsWith(".json") && /^\s*```/.test(block.content)) {
    return { path: block.path, content: unwrapFence(block.content) };
  }
  if (block.path.endsWith(".cpp") || block.path.endsWith(".py")) {
    let content = stripProseHeader(block.content);
    if (block.path.endsWith(".cpp")) {
      content = fixCppNamespace(content);
    }
    return { path: block.path, content };
  }
  return block;
}

/**
 * Repair the classic "bare cout/cin not declared" compile failure.
 *
 * Models frequently emit `cout << ...` without `std::` and without a
 * `using namespace std;`. Rather than burning a repair round on it, add
 * the using-declaration when the file references bare standard names and
 * has no namespace import of its own.
 */
function fixCppNamespace(content: string): string {
  const usesBareName = /\b(cout|cin|cerr|endl|vector|string|sort|max|min|pair|queue|priority_queue|set|map|swap|abs|reverse|unique|lower_bound|upper_bound)\b/.test(
    content,
  );
  if (!usesBareName) {
    return content;
  }
  const hasUsing =
    /using\s+namespace\s+std\s*;/.test(content) ||
    /using\s+std::/.test(content);
  if (hasUsing) {
    return content;
  }
  // Insert after the last #include line (or at the top).
  const lines = content.split("\n");
  let lastInclude = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]?.trim().startsWith("#include")) {
      lastInclude = i;
    }
  }
  lines.splice(lastInclude + 1, 0, "", "using namespace std;");
  return lines.join("\n");
}

/**
 * Remove leading prose the model sometimes writes before the actual code.
 *
 * Observed in real runs: a Chinese explanation line like "（先读取后再输出）"
 * before the first #include, which is a hard compile error. Real code starts
 * with #include, #define, a comment marker, "using", "import" or similar;
 * anything else at the very top is stray prose and gets dropped.
 */
function stripProseHeader(content: string): string {
  const lines = content.split("\n");
  let i = 0;
  // Skip blank lines.
  while (i < lines.length && lines[i]?.trim() === "") {
    i += 1;
  }
  const first = lines[i] ?? "";
  if (
    first.startsWith("#") ||
    first.startsWith("//") ||
    first.startsWith("/*") ||
    first.startsWith("*") ||
    /^(using|import|from|typedef|struct|class|template|namespace|constexpr|static|const)\b/.test(
      first.trim(),
    ) ||
    first.trim() === ""
  ) {
    return content;
  }
  // Stray prose line(s): drop until the first line that looks like code.
  while (
    i < lines.length &&
    lines[i] !== undefined &&
    !/^\s*(#|\/\/|\/\*|using |import |from |typedef |struct |class |template |namespace |constexpr |static |const |int |long |void |bool |char |double |float |auto |std::)/.test(
      lines[i] as string,
    )
  ) {
    i += 1;
  }
  return lines.slice(i).join("\n");
}

function extractPatch(
  files: GeneratedFile[],
  path: string,
): Record<string, unknown> | null {
  const file = files.find((f) => f.path === path);
  if (!file) {
    return null;
  }
  try {
    const parsed = JSON.parse(unwrapFence(file.content)) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Merge a role patch onto the config.
 *
 * A shallow assign is NOT safe here, and the earlier claim that roles own
 * disjoint field sets was wrong: both the architect and judge-validator own
 * `generator`. The judge-validator's canonical patch carries
 * `generator: { path, cases: [] }` (the prompt shows exactly that), so a bare
 * spread replaced the architect's entire 30-case plan with an empty list. The
 * run then failed with "没有成功生成的测试点" and no repair round could fix it,
 * because the repair prompt only rewrites source files - never the case plan.
 *
 * So `generator` is merged field-wise and an empty `cases` never overwrites a
 * non-empty plan: a worker sending `cases: []` means "I am not changing the
 * case plan", which is precisely what the prompt tells it. An empty list is
 * never a meaningful update to a non-empty case plan, so this cannot lose
 * intentional data.
 */
function mergeGenerator(
  base: ProblemConfig["generator"],
  patch: unknown,
): ProblemConfig["generator"] {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return base;
  }
  const incoming = patch as Record<string, unknown>;
  const next: ProblemConfig["generator"] = { ...base };

  if (typeof incoming.path === "string" && incoming.path.trim() !== "") {
    next.path = incoming.path;
  }
  if (Array.isArray(incoming.cases) && incoming.cases.length > 0) {
    next.cases = incoming.cases as ProblemConfig["generator"]["cases"];
  }
  return next;
}

function applyPatch(config: ProblemConfig, patch: Record<string, unknown>): ProblemConfig {
  const next = { ...config, ...patch } as ProblemConfig;
  if ("generator" in patch) {
    next.generator = mergeGenerator(config.generator, patch.generator);
  }
  return next;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Collapse a failure list into a short digest that keeps distinct causes.
 *
 * A single broken generator reports the same message once per case (39
 * identical "generator 失败：case=..." lines on dp-011). Fed through raw, that
 * repetition consumes the entire digest budget, hides every other failure
 * behind it, and tells the model nothing it did not already know from the
 * first line.
 */
export function summarizeFailures(
  failures: { scope: string; message: string }[],
): string {
  /** Strip the per-case detail so identical causes fold into one entry. */
  const kind = (message: string) =>
    message
      .replace(/case=\S+/g, "case=<...>")
      .replace(/\s+/g, " ")
      .trim();

  const groups = new Map<string, { sample: string; count: number }>();
  for (const failure of failures) {
    const key = kind(failure.message);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { sample: failure.message, count: 1 });
    }
  }

  // Most frequent first: a cause repeated across every case is the one that
  // makes the whole run fail, so it should lead the digest.
  return [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([, group]) =>
      group.count > 1
        ? `- ${group.sample}\n  （同类失败共 ${group.count} 例，原因相同，请一次修好）`
        : `- ${group.sample}`,
    )
    .join("\n");
}

function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function stage(
  role: PipelineRole,
  title: string,
  status: PipelineStage["status"],
  extra: Partial<PipelineStage> = {},
): PipelineStage {
  return {
    role,
    title,
    status,
    startedAt: extra.startedAt ?? null,
    finishedAt: extra.finishedAt ?? null,
    wrote: extra.wrote ?? [],
    summary: extra.summary ?? "",
    error: extra.error ?? null,
  };
}

const STAGE_TITLES: Record<PipelineRole, string> = {
  architect: "定架构与题面",
  "judge-validator": "judge 与数据",
  "solutions-tutorial": "标程与题解",
  integrator: "整体一致性审查",
  verifier: "本地验题",
};

async function listWorkspaceFiles(slug: string): Promise<string[]> {
  const root = problemDir(slug);
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "testdata" || entry.name === "exported-tests") {
          continue;
        }
        await walk(`${dir}/${entry.name}`, rel);
      } else {
        out.push(rel);
      }
    }
  }
  await walk(root, "");
  return out.sort();
}

async function readIfPresent(slug: string, relative: string): Promise<string> {
  try {
    return await fs.readFile(`${problemDir(slug)}/${relative}`, "utf8");
  } catch {
    return "";
  }
}

/**
 * Repair the common ways a model gets the config schema wrong, before
 * validation rejects it outright.
 *
 * Observed from real failed runs: timeLimit/memoryLimit instead of
 * timeLimitMs/memoryLimitMb, "tag" instead of "role"/"expected", a string
 * generator, cases missing name/group, checkWith as a bare string. Each of
 * these has exactly one intended meaning, so remapping is safe; anything
 * ambiguous is left for the validator to report.
 */
function repairConfig(input: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = { ...input };

  // Field-name drift: the model writes timeLimit/memoryLimit; the schema
  // wants timeLimitMs/memoryLimitMb. Move when the canonical key is absent.
  if (config.timeLimitMs === undefined) {
    const limit = config.timeLimit ?? config.time_limit;
    if (typeof limit === "number") {
      config.timeLimitMs = limit;
    }
  }
  delete config.timeLimit;
  delete config.time_limit;

  if (config.memoryLimitMb === undefined) {
    const limit = config.memoryLimit ?? config.memory_limit;
    if (typeof limit === "number") {
      config.memoryLimitMb = limit;
    }
  }
  delete config.memoryLimit;
  delete config.memory_limit;

  // Required doc paths the model tends to omit (they are fixed by layout).
  if (typeof config.statement !== "string") {
    config.statement = "docs/statement.md";
  }
  if (typeof config.tutorial !== "string") {
    config.tutorial = "docs/tutorial.md";
  }

  // A string generator path plus a separate cases array is the model
  // splitting one object into two keys. A duplicate "generator" key in raw
  // JSON means JSON.parse kept only the last one, so also accept a cases
  // array living beside a missing path.
  if (typeof config.generator === "string") {
    const path = config.generator;
    const cases =
      (config.generatorCases as unknown[]) ??
      (config.cases as unknown[]) ??
      [];
    config.generator = { path, cases };
    delete config.generatorCases;
    delete config.cases;
  }

  if (config.generator && typeof config.generator === "object") {
    const generator = { ...(config.generator as Record<string, unknown>) };
    if (typeof generator.path !== "string" || generator.path === "") {
      generator.path = "src/generator/generator.cpp";
    } else if (!String(generator.path).startsWith("src/")) {
      // Bare filenames like "generator.cpp" belong under src/generator/.
      generator.path = `src/generator/${generator.path}`;
    }
    if (!Array.isArray(generator.cases)) {
      generator.cases =
        (config.generatorCases as unknown[]) ??
        (config.cases as unknown[]) ??
        [];
      delete config.generatorCases;
      delete config.cases;
    }
    if (Array.isArray(generator.cases)) {
      generator.cases = generator.cases.map((entry, index) => {
        if (typeof entry !== "object" || entry === null) {
          return entry;
        }
        const item = { ...(entry as Record<string, unknown>) };
        if (typeof item.name !== "string" || item.name === "") {
          item.name = `case-${String(index + 1).padStart(2, "0")}`;
        }
        // The type is a category name ("sample"), not a per-case id
        // ("sample-1"). Models sometimes copy the numbered name into type;
        // the verifier passes type to the generator as argv[1], so a
        // numbered type means "Unknown case type" on every case.
        if (typeof item.type === "string") {
          item.type = item.type.replace(/-\d+$/, "");
        }
        if (typeof item.group !== "string" || item.group === "") {
          item.group = item.type === "sample" ? "sample" : "secret";
        }
        if (typeof item.checkWith === "string") {
          item.checkWith = [item.checkWith];
        }
        // checkWith must reference solution names, never file paths.
        if (Array.isArray(item.checkWith)) {
          item.checkWith = (item.checkWith as unknown[]).filter(
            (name) => typeof name === "string" && !String(name).includes("/"),
          );
          if ((item.checkWith as unknown[]).length === 0) {
            delete item.checkWith;
          }
        }
        delete item.args;
        return item;
      });
    }
    config.generator = generator;
  } else if (!config.generator) {
    // No generator at all: default shape with an empty case list. The
    // judge-validator worker owns the generator and fills the cases in via
    // its config patch, together with the validator that must accept them.
    config.generator = { path: "src/generator/generator.cpp", cases: [] };
  }

  // Models sometimes emit solutions/wrongSolutions as an object keyed by
  // name instead of an array. Convert: values become entries, the key
  // becomes the name when the entry lacks one.
  for (const field of ["solutions", "wrongSolutions"] as const) {
    const value = config[field];
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const entries = Object.entries(value as Record<string, unknown>);
      config[field] = entries.map(([key, entry], index) => {
        if (typeof entry !== "object" || entry === null) {
          return { name: key, path: String(entry) };
        }
        const item = { ...(entry as Record<string, unknown>) };
        if (typeof item.name !== "string" || item.name === "") {
          item.name = key;
        }
        if (field === "solutions" && item.path === undefined) {
          item.path = `src/solution${index === 0 ? "" : String(index + 1)}.cpp`;
        }
        return item;
      });
    }
  }

  if (Array.isArray(config.solutions)) {
    config.solutions = config.solutions.map((entry, index) => {
      if (typeof entry !== "object" || entry === null) {
        return entry;
      }
      const item = { ...(entry as Record<string, unknown>) };
      if (item.role === undefined && typeof item.tag === "string") {
        item.role = item.tag === "main" ? "main" : "reference";
      }
      // Patches sometimes carry entries without a name; derive one from the
      // path so the schema's required name is always present.
      if (typeof item.name !== "string" || item.name === "") {
        const file = String(item.path ?? "")
          .split("/")
          .pop();
        item.name =
          (file ?? "").replace(/\.(cpp|py)$/, "").replace(/[^a-z0-9-]/gi, "-") ||
          `solution-${index + 1}`;
      }
      delete item.tag;
      return item;
    });
    // Python reference solutions are not part of the verification flow and
    // fail the compile stage when the environment lacks a working python;
    // drop them so only the C++ pair is judged.
    config.solutions = (config.solutions as Record<string, unknown>[]).filter(
      (item) => item.language !== "python" && !String(item.path ?? "").endsWith(".py"),
    );
  }

  if (Array.isArray(config.wrongSolutions)) {
    config.wrongSolutions = config.wrongSolutions.map((entry, index) => {
      if (typeof entry !== "object" || entry === null) {
        return entry;
      }
      const item = { ...(entry as Record<string, unknown>) };
      if (item.expected === undefined && typeof item.tag === "string") {
        item.expected = "observe";
      }
      // Wrong solutions are observe-only by design: they record behaviour
      // for analysis but never fail the verification. A model-written
      // "fail" expectation turns data-strength gaps into hard failures.
      item.expected = "observe";
      // Same name derivation as solutions: patches drop the name field.
      if (typeof item.name !== "string" || item.name === "") {
        const file = String(item.path ?? "")
          .split("/")
          .pop();
        item.name =
          (file ?? "").replace(/\.(cpp|py)$/, "").replace(/[^a-z0-9-]/gi, "-") ||
          `wrong-${index + 1}`;
      }
      delete item.tag;
      return item;
    });
  }

  // Path fields the model shortens.
  for (const field of ["validator", "checker", "interactor"] as const) {
    const value = config[field];
    if (typeof value === "string" && value !== "" && !value.includes("/")) {
      config[field] =
        field === "validator"
          ? `src/validator/${value}`
          : `src/checker/${value}`;
    }
  }

  return config;
}

async function readConfig(slug: string): Promise<ProblemConfig> {
  const raw = await fs.readFile(`${problemDir(slug)}/config.json`, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `模型输出的 config.json 不是合法 JSON。原始内容开头：${raw.slice(0, 200)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("模型输出的 config.json 不是 JSON 对象。");
  }
  const repaired = repairConfig(parsed as Record<string, unknown>);
  const result = problemConfigSchema.safeParse(repaired);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(根)"}: ${i.message}`)
      .join("; ");
    throw new Error(
      `模型输出的 config.json 结构不符合要求（${issues}）。` +
        `这通常是模型没有严格按 schema 输出，重试一次通常可以解决。`,
    );
  }
  // Persist the repaired form so the verifier reads the same shape.
  if (JSON.stringify(repaired) !== JSON.stringify(parsed)) {
    await fs.writeFile(
      `${problemDir(slug)}/config.json`,
      `${JSON.stringify(result.data, null, 2)}\n`,
      "utf8",
    );
  }
  return result.data;
}

async function writeConfig(slug: string, config: ProblemConfig): Promise<void> {
  // Patches merged on top of the config can carry the same field-shape
  // drift the initial output had (string generator, object solutions), so
  // the write path repairs exactly like the read path before validating.
  const repaired = repairConfig(config as unknown as Record<string, unknown>);
  const result = problemConfigSchema.safeParse(repaired);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(根)"}: ${i.message}`)
      .join("; ");
    throw new Error(`config.json 合并后校验失败（${issues}）。`);
  }
  await fs.writeFile(
    `${problemDir(slug)}/config.json`,
    `${JSON.stringify(result.data, null, 2)}\n`,
    "utf8",
  );
}

/** Cap the shared context so a runaway statement cannot blow the context budget. */
function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n\n...（题面过长，已截断）`;
}

export async function runPipeline(
  brief: PipelineBrief,
  emit: Emit,
): Promise<PipelineRun> {
  if (!isValidCategory(brief.category)) {
    throw new Error(
      `分类 "${brief.category}" 不合法。只允许小写字母、数字与单个连字符分隔，例如 "dp"、"graph-theory"。`,
    );
  }
  brief.difficulty = difficultySchema.parse(brief.difficulty);

  // Allocate the next problem number inside the category BEFORE any LLM
  // call, so the workspace path is fixed for the whole run.
  const allocation = await allocateProblem(brief.category, brief.categoryLabel);
  const problemId = allocation.problemId;
  const dirName = allocation.dir;

  const runId = newRunId();
  const stages: PipelineStage[] = [];

  const run: PipelineRun = {
    id: runId,
    slug: problemId,
    premise: brief.premise,
    difficulty: brief.difficulty,
    interactive: brief.interactive,
    stages,
    startedAt: nowIso(),
    finishedAt: null,
    status: "running",
  };

  const log = (role: PipelineRole, message: string) =>
    emit({ type: "log", runId, role, message });

  /**
   * Captured exchanges for dataset accumulation (the local-model route).
   *
   * The prompts and replies are recorded as they happen, but only persisted
   * after the verifier passes: a sample that failed verification teaches the
   * wrong thing.
   */
  const captured: {
    role: PipelineRole;
    system: string;
    user: string;
    assistant: string;
  }[] = [];

  /** Advance a stage to a new status and publish the run. */
  const advance = (
    role: PipelineRole,
    status: PipelineStage["status"],
    extra: Partial<PipelineStage> = {},
  ) => {
    const index = stages.findIndex((s) => s.role === role);
    const next = stage(role, STAGE_TITLES[role], status, {
      ...extra,
      ...(status === "running" && !extra.startedAt ? { startedAt: nowIso() } : {}),
      ...(status === "done" || status === "failed" || status === "skipped"
        ? { finishedAt: extra.finishedAt ?? nowIso() }
        : {}),
    });
    if (index >= 0) {
      stages[index] = next;
    } else {
      stages.push(next);
    }
    emit({ type: "stage", run: { ...run, stages: [...stages] } });
    return next;
  };

  /* ---------------- architect ---------------- */

  advance("architect", "running");
  try {
    await createWorkspace(problemId, brief.interactive);
    log("architect", `已创建工作区 problems/${problemId}`);

    const reply = await complete(
      [
        { role: "system", content: architectSystem() },
        { role: "user", content: architectUser(brief) },
      ],
      { model: architectModel() },
    );
    captured.push({
      role: "architect",
      system: architectSystem(),
      user: architectUser(brief),
      assistant: reply,
    });

    const blocks = parseFileBlocks(reply).map(stripFencesFor);
    const wanted = new Set(["config.json", "docs/statement.md", "meta.json"]);
    const payload = blocks.filter((b) => wanted.has(b.path));
    const missing = [...wanted].filter(
      (p) => !payload.some((b) => b.path === p),
    );
    if (missing.length > 0) {
      throw new Error(`architect 未产出必需文件: ${missing.join(", ")}`);
    }

    const { failed } = await writeGeneratedFiles(problemId, payload);
    if (failed.length > 0) {
      throw new Error(
        `architect 文件写入失败: ${failed.map((f) => `${f.path} (${f.error})`).join("; ")}`,
      );
    }

    const config = await readConfig(problemId);

    // An empty case plan is fatal and unrecoverable downstream, so refuse it
    // here - before meta is written and before the problem is recorded in the
    // category index. Nothing later in the pipeline can invent a data plan:
    // the workers implement the types they are given, and the repair loop only
    // rewrites source files. Letting it through produced exactly one failure
    // mode - "没有成功生成的测试点" after four repair rounds that had no way to
    // succeed, with the broken problem left registered in the index.
    if (config.generator.cases.length === 0) {
      throw new Error(
        "architect 没有规划任何测试点（generator.cases 为空）。" +
          "数据计划是整道题的骨架，缺失时后续阶段无法补齐。请重试生成；" +
          "若反复出现，说明模型没有遵守 config.json 的 schema。",
      );
    }

    // Fill the system-owned meta fields instead of trusting the model for them.
    const metaRaw = extractPatch(payload, "meta.json") ?? {};
    const meta: ProblemMeta = problemMetaSchema.parse({
      ...metaRaw,
      slug: dirName,
      title: config.title,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      verification: null,
    });
    await writeMeta(problemId, meta);

    const statement = await readIfPresent(problemId, config.statement);
    // The format contract from the architect: every worker must parse and
    // emit exactly this shape. Without it, the validator, generator and
    // solutions each read the statement independently and drift apart -
    // the observed failure was three different line counts for one input.
    const formatContract = meta.inputFormat
      ? `输入格式契约（validator 校验、generator 输出、标程读入必须完全一致）：${meta.inputFormat}`
      : "";
    const outputContract = meta.outputFormat
      ? `输出格式契约（标程与 checker 判定必须完全一致）：${meta.outputFormat}`
      : "";
    const approach = truncate(
      `${meta.premise}\n\n预期正解方向：${meta.expectedApproach}\n\n期望复杂度：${meta.complexity}` +
        (formatContract ? `\n\n${formatContract}` : "") +
        (outputContract ? `\n\n${outputContract}` : ""),
      4000,
    );

    // An empty case plan is fatal and unrecoverable downstream, so refuse it
    // here rather than discovering it at the verifier. See the guard right
    // after readConfig, which is where this is actually enforced.
    //
    // The judge-validator worker owns the generator and MUST implement every
    // type listed here; without this list the worker invents its own type names
    // and the verifier fails with "Unknown case type" on every planned case.
    // The coverage note travels with each case so the generator implements the
    // intended intent rather than just matching the type name.
    const casePlan = config.generator.cases
      .map((c) => {
        const intent = c.coverage?.trim();
        return `- ${c.name}: type=${c.type}, seed=${c.seed}, group=${c.group}${intent ? `（意图：${intent}）` : ""}`;
      })
      .join("\n");
    const dataRanges = truncate(
      `数据范围要点（generator 与 validator 必须一致）：` +
        `时间限制 ${config.timeLimitMs}ms，内存 ${config.memoryLimitMb}MB。` +
        `题面的数据范围见下方题面原文，generator 生成的每个数值都必须落在题面声明的范围内。`,
      500,
    );

    advance("architect", "done", {
      wrote: payload.map((p) => p.path).sort(),
      summary: `${config.title} · ${meta.tags.join("/") || "未分类"} · 规划 ${config.generator.cases.length} 个 case`,
    });

    // Record the problem in the category index so the registry shows it
    // (and so the next generation in this category allocates the next number).
    await recordProblem(brief.category, {
      dir: dirName,
      title: config.title,
      difficulty: meta.difficulty,
      tags: meta.tags,
      createdAt: nowIso(),
    });
    log("architect", `已登记到分类索引 problems/${brief.category}/index.json`);

    /* ---------------- parallel workers ---------------- */

    const workerSpecs: {
      role: PipelineRole;
      model: string;
      system: string;
      targets: string[];
    }[] = [
      {
        role: "judge-validator",
        model: workerModel(),
        system: judgeValidatorSystem(brief),
        targets: [
          brief.interactive
            ? "src/checker/interactor.cpp"
            : "src/checker/checker.cpp",
          "src/validator/validator.cpp",
          "src/generator/generator.cpp",
        ],
      },
      {
        role: "solutions-tutorial",
        model: workerModel(),
        system: solutionsTutorialSystem(brief),
        targets: ["src/solution.cpp", "src/solution2.cpp", "docs/tutorial.md"],
      },
    ];

    for (const spec of workerSpecs) {
      advance(spec.role, "running");
      log(spec.role, `并行启动：${spec.targets.join("、")}`);
    }

    const workerResults = await Promise.allSettled(
      workerSpecs.map(async (spec) => {
        const system = spec.system;
        // Every worker sees the architect's exact case plan: the generator
        // must implement each type, the validator must accept what those
        // types produce, and the solutions must handle the ranges they hit.
        const user = workerUser(
          brief,
          `${approach}\n\n${dataRanges}\n\n--- 主 agent 规划的 case 清单（必须逐个实现，type 名一个都不能改）---\n${casePlan}\n\n--- 题面 ---\n${truncate(statement, 12000)}`,
          spec.targets,
        );
        const reply = await complete(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { model: spec.model },
        );
        return { spec, system, user, reply };
      }),
    );

    // Collect patches first, then apply them in a fixed order.
    const patches: Record<PipelineRole, Record<string, unknown> | null> = {
      architect: null,
      "judge-validator": null,
      "solutions-tutorial": null,
      integrator: null,
      verifier: null,
    };

    for (const [index, spec] of workerSpecs.entries()) {
      const role = spec.role;
      const outcome = workerResults[index];
      if (!outcome) {
        continue;
      }

      if (outcome.status === "rejected") {
        const reason =
          outcome.reason instanceof LlmError
            ? outcome.reason.message
            : (outcome.reason as Error).message;
        advance(role, "failed", { error: reason });
        log(role, `失败：${reason}`);
        continue;
      }

      captured.push({
        role,
        system: outcome.value.system,
        user: outcome.value.user,
        assistant: outcome.value.reply,
      });

      // Accept anything under src/ or docs/ plus JSON patches. Precise
      // target matching proved brittle: models write "src/wrong/greedy.cpp"
      // when the target said "src/wrong/", or slightly different names, and
      // the file was silently dropped - leaving the scaffold template in
      // place and the verifier failing on "Unknown case type".
      const allBlocks = parseFileBlocks(outcome.value.reply).map(stripFencesFor);
      const blocks = allBlocks.filter(
        (b: GeneratedFile) =>
          b.path.endsWith(".json") ||
          b.path.startsWith("src/") ||
          b.path.startsWith("docs/"),
      );
      const dropped = allBlocks.filter((b: GeneratedFile) => !blocks.includes(b));
      for (const drop of dropped) {
        log(role, `忽略目标外的文件块：${drop.path}`);
      }
      const patch = extractPatch(blocks, "config.patch.json");
      const writes = blocks.filter((b: GeneratedFile) => b.path !== "config.patch.json");
      const result = await writeGeneratedFiles(problemId, writes);

      if (writes.length === 0 && !patch) {
        // Diagnose protocol violations: show what the reply actually began
        // with so the failure is actionable instead of a silent zero.
        const preview = outcome.value.reply
          .replace(/\s+/g, " ")
          .slice(0, 300);
        log(
          role,
          `警告：没有写出任何文件。模型回复包含 ${allBlocks.length} 个文件块，` +
            `回复开头：${preview}`,
        );
      }

      for (const failure of result.failed) {
        log(role, `文件写入失败 ${failure.path}：${failure.error}`);
      }

      patches[role] = patch;
      advance(role, "done", {
        wrote: result.written.sort(),
        summary: patch
          ? `写出 ${result.written.length} 个文件，并更新 ${Object.keys(patch).join("、")}`
          : `写出 ${result.written.length} 个文件`,
      });
    }

    let merged = await readConfig(problemId);
    for (const spec of workerSpecs) {
      const patch = patches[spec.role];
      if (!patch) {
        continue;
      }
      // Validate each patch in isolation: a patch with malformed entries
      // (missing names, wrong shapes) must not corrupt the good config.
      // Repair first, then dry-run the schema; skip the patch only when
      // even the repaired form fails.
      const candidate = applyPatch(merged, patch);
      const repaired = repairConfig(
        candidate as unknown as Record<string, unknown>,
      );
      const check = problemConfigSchema.safeParse(repaired);
      if (check.success) {
        merged = check.data;
      } else {
        const issues = check.error.issues
          .map((i) => i.path.join("."))
          .slice(0, 3)
          .join(", ");
        log(
          "integrator",
          `跳过 ${spec.role} 的 config 补丁（修复后仍不合法：${issues}）`,
        );
      }
    }
    await writeConfig(problemId, merged);
    log(
      "integrator",
      `已合并 ${workerSpecs.filter((s) => patches[s.role]).length} 个角色的 config 补丁`,
    );

    /* ---------------- integrator ---------------- */

    advance("integrator", "running");
    try {
      const currentFiles = await listWorkspaceFiles(problemId);
      const configText = JSON.stringify(await readConfig(problemId), null, 2);
      const statementNow = await readIfPresent(problemId, merged.statement);
      const tutorial = await readIfPresent(problemId, merged.tutorial);

      const reply = await complete(
        [
          { role: "system", content: integratorSystem() },
          {
            role: "user",
            content: [
              "## 工作区文件清单",
              currentFiles.map((f) => `- ${f}`).join("\n"),
              "",
              "## config.json",
              "```json",
              configText,
              "```",
              "",
              "## docs/statement.md",
              "```markdown",
              truncate(statementNow, 12000),
              "```",
              "",
              "## docs/tutorial.md",
              "```markdown",
              truncate(tutorial, 12000),
              "```",
            ].join("\n"),
          },
        ],
        { model: architectModel() },
      );

      if (/NO_CHANGES_REQUIRED/.test(reply)) {
        advance("integrator", "done", {
          summary: "未发现需要修复的问题",
        });
      } else {
        const blocks = parseFileBlocks(reply)
          .map(stripFencesFor)
          .filter((b) => !b.path.endsWith(".patch.json"));
        const patch = extractPatch(blocks, "config.json");
        const writes = blocks.filter((b) => b.path !== "config.json");
        await writeGeneratedFiles(problemId, writes);
        if (patch) {
          await writeConfig(problemId, applyPatch(merged, patch));
        }
        advance("integrator", "done", {
          wrote: blocks.map((b) => b.path).sort(),
          summary: blocks.length > 0 ? `修正 ${blocks.length} 个文件` : "未做修改",
        });
      }
    } catch (error) {
      advance("integrator", "failed", {
        error: (error as Error).message,
      });
      log("integrator", `失败：${(error as Error).message}`);
    }

    /* ---------------- verifier (with repair loop) ---------------- */

    if (verificationEnabled()) {
      advance("verifier", "running");
      log("verifier", "调用 run-all-tests.ps1 本地验题，耗时可能较长");

      // Config/workspace reconciliation. Runs before the first verification
      // attempt because run-all-tests.ps1 resolves every solution path while
      // parsing config.json and throws on the first missing file - so one
      // phantom entry would fail the entire run before any case is generated,
      // and no amount of retrying would clear it.
      // A missing wrong solution is expected to happen: the architect declares
      // them from the plan, and an observe-only wrong solution that was never
      // written carries no information, so the entry is dropped and reported.
      try {
        const dropped = await dropMissingSolutionEntries(problemId);
        if (dropped && dropped.length > 0) {
          for (const item of dropped) {
            log("verifier", `丢弃指向不存在文件的解法条目：${item}`);
          }
          log(
            "verifier",
            `已从 config.json 移除 ${dropped.length} 个无对应源文件的解法条目`,
          );
        }
      } catch (error) {
        log("verifier", `config 与工作区对齐跳过：${(error as Error).message}`);
      }

      // Data-coverage audit. The whole data strategy rests on the plan being
      // honoured, so report where it is thin before spending minutes on the
      // verifier. Advisory only: a coverage gap is a judgement call about data
      // strength, and the verifier is what actually decides pass/fail. Logging
      // it here also makes the gap visible in the run transcript, which is the
      // only place a user sees why a green run may still be weak.
      try {
        const report = auditCoverage(await readConfig(problemId));
        log("verifier", summarizeCoverage(report));
        for (const gap of report.gaps) {
          log("verifier", `数据覆盖提示（${gap.kind}）：${gap.message}`);
        }
      } catch (error) {
        log("verifier", `数据覆盖审计跳过：${(error as Error).message}`);
      }

      // Align config case types with the generator's implemented branches.
      // Models sometimes decorate type names when writing the generator
      // (config says "sorted", generator implements "sorted-small"), which
      // fails every case with "Unknown case type". The generator is the
      // more concrete artefact, so the config follows it.
      try {
        const generatorSource = await readIfPresent(
          problemId,
          "src/generator/generator.cpp",
        );
        if (generatorSource) {
          const branches = new Set<string>();
          for (const match of generatorSource.matchAll(
            /type\s*==\s*"([^"]+)"/g,
          )) {
            if (match[1]) {
              branches.add(match[1]);
            }
          }
          const config = await readConfig(problemId);
          let changed = false;
          const cases = config.generator.cases.map((item) => {
            if (!branches.has(item.type)) {
              // Look for a branch that extends the planned type
              // ("sorted" -> "sorted-small") or vice versa.
              const candidate =
                [...branches].find(
                  (b) => b === item.type || b.startsWith(`${item.type}-`) || item.type.startsWith(`${b}-`),
                ) ?? null;
              if (candidate) {
                changed = true;
                return { ...item, type: candidate };
              }
            }
            return item;
          });
          if (changed) {
            await writeConfig(problemId, { ...config, generator: { ...config.generator, cases } });
            log("verifier", "已将 config 的 case type 对齐到 generator 实际实现的分支");
          }
        }
      } catch (error) {
        log("verifier", `type 对齐跳过：${(error as Error).message}`);
      }

      // Compile preflight: surface every compile error before the slow
      // verification run, so a single repair round can fix all of them at
      // once. Without this, each round only sees the first error that
      // verification happens to hit, and a problem with several independent
      // defects exhausts the round budget while fixing them one at a time.
      let compileDiagnostics: string[] = [];
      try {
        compileDiagnostics = await preflightCompile(
          problemId,
          await readConfig(problemId),
        );
        if (compileDiagnostics.length > 0) {
          log(
            "verifier",
            `编译预检发现 ${compileDiagnostics.length} 个文件无法编译，将一次性交给修复轮`,
          );
        }
      } catch (error) {
        log("verifier", `编译预检跳过：${(error as Error).message}`);
      }

      // A failed verification is usually a fixable defect in one generated
      // file (a compile error, a range mismatch). Feed the failure digest
      // back to the integrator for a repair pass, then re-verify. Compile
      // errors often come in chains (fixing one reveals the next), so several
      // repair rounds are allowed - but each round is a full model call, so
      // both the round count and the no-progress case are bounded.
      const MAX_REPAIR_ROUNDS = 4;
      let verification: Awaited<ReturnType<typeof verifyWorkspace>> | null =
        null;

      /**
       * What earlier rounds already tried, so the model does not repeat them.
       *
       * Each round rebuilds its prompt from the CURRENT file contents, so a
       * failed attempt leaves no trace the model can see: it receives the same
       * broken file it just wrote and emits the same broken fix again. Observed
       * on math-001, where four rounds produced a byte-identical checker.cpp
       * and the identical compile error four times. Carrying the failures
       * forward is what makes a later round different from an earlier one.
       */
      const attempts: { round: number; digest: string; wrote: string[] }[] = [];
      /** Digest of the previous round, for detecting that nothing changed. */
      let previousSignature: string | null = null;
      let stagnantRounds = 0;

      for (let round = 0; round <= MAX_REPAIR_ROUNDS; round += 1) {
        try {
          verification = await verifyWorkspace(problemId);
        } catch (error) {
          advance("verifier", "failed", { error: (error as Error).message });
          log("verifier", `失败：${(error as Error).message}`);
          break;
        }

        if (verification.passed) {
          break;
        }

        if (round === MAX_REPAIR_ROUNDS) {
          break;
        }

        // "No test point was generated" cannot be repaired by rewriting source
        // files, and that is all the repair round is allowed to do (writeConfig
        // is deliberately excluded below, because a model-rewritten config
        // reintroduces shape drift). Retrying therefore burns four model calls
        // to reach the same failure. Stop at the first occurrence and say why.
        if (
          verification.failures.some((f) => f.message.includes("没有成功生成的测试点"))
        ) {
          log(
            "verifier",
            "数据计划为空（没有成功生成的测试点），修复轮只改源码、无法补齐 cases，跳过修复。",
          );
          break;
        }

        // Detect a repair round that changed nothing.
        //
        // The signature is the failure set itself: if the same failures come
        // back after a repair attempt, that attempt did not address the cause.
        // One repeat can be legitimate (a fix reveals the next error, or the
        // model chose NO_CHANGES_REQUIRED); two identical repeats mean the loop
        // is not converging, and further rounds would only repeat the same
        // prompt at full model cost - exactly what happened on math-001.
        const signature = verification.failures
          .map((f) => `${f.scope}|${f.message}`)
          .sort()
          .join("\n");
        if (signature === previousSignature) {
          stagnantRounds += 1;
        } else {
          stagnantRounds = 0;
          previousSignature = signature;
        }
        if (stagnantRounds >= 2) {
          log(
            "verifier",
            `连续 ${stagnantRounds + 1} 轮出现完全相同的失败，修复没有产生任何变化，提前终止修复轮` +
              `（避免继续消耗模型调用）。建议人工检查或重新生成这道题。`,
          );
          break;
        }

        // Repair round: hand the failure digest to the integrator, along
        // with the current content of the files the failures point at -
        // without the source, the model can only guess at the fix.
        //
        // The digest is folded by failure kind before it is truncated. One
        // broken generator reports the same message once per case (39 identical
        // "generator 失败：case=..." lines on dp-011), which consumed the whole
        // 10-line budget and hid every other failure behind the repetition -
        // and told the model nothing it did not already know from line one.
        const digest = summarizeFailures(verification.failures);

        // A preflight need not have run (verification disabled, no compiler),
        // in which case compile errors only show up inside the digest. When it
        // did run, prefer its results: they are compiler output, not the
        // verifier's summary of it.
        const compileSection =
          compileDiagnostics.length > 0
            ? [
                "",
                "## 编译预检：以下文件当前无法编译（已一次性列出全部）",
                "",
                "**请在这一轮里把它们全部修好**，不要只修第一个。",
                "每一段都以文件名开头，后面是编译器的错误信息。",
                "",
                ...compileDiagnostics,
              ]
            : [];

        // Extract file paths mentioned in the failures and inline them.
        const mentionedFiles = new Set<string>();
        for (const failure of verification.failures.slice(0, 10)) {
          const matches = failure.message.match(/[A-Za-z]:\\[^\s:]+\.cpp/g);
          for (const match of matches ?? []) {
            const rel = match
              .replace(/\\/g, "/")
              .split(`/${problemId.split("/")[1]}/`)
              .pop();
            if (rel && rel.endsWith(".cpp") && rel.includes("/")) {
              mentionedFiles.add(rel);
            }
          }
        }
        const fileContents = await Promise.all(
          [...mentionedFiles].slice(0, 3).map(async (rel) => {
            const content = await readIfPresent(problemId, rel);
            return content
              ? `### ${rel}\n\`\`\`cpp\n${truncate(content, 8000)}\n\`\`\``
              : null;
          }),
        );
        const fileSection = fileContents
          .filter(Boolean)
          .join("\n\n");

        log(
          "verifier",
          `验题未通过，开始第 ${round + 1} 轮修复（完整日志：verify-logs/${verification.logPath ?? ""}）`,
        );

        try {
          const repairReply = await complete(
            [
              { role: "system", content: integratorSystem() },
              {
                role: "user",
                content: [
                  "## 本地验题失败信息",
                  "",
                  digest,
                  ...compileSection,
                  ...(attempts.length > 0
                    ? [
                        "",
                        "## 前面几轮修复已经尝试过、并且**没有解决问题**",
                        "",
                        "下面每一条都是上一轮修复后重新验题得到的失败信息。",
                        "**不要重复这些已经失败的改法**——如果上一轮改了某个文件仍然报同样的错，",
                        "说明那个改法不是根因，请换一个方向，或指出该失败无法通过改源码解决。",
                        "",
                        ...attempts.flatMap((attempt) => [
                          `### 第 ${attempt.round} 轮修复${
                            attempt.wrote.length > 0
                              ? `（重写了 ${attempt.wrote.join("、")}）`
                              : "（模型未修改任何文件）"
                          }`,
                          "",
                          "```text",
                          truncate(attempt.digest, 2500),
                          "```",
                          "",
                        ]),
                      ]
                    : []),
                  ...(fileSection
                    ? ["", "## 失败涉及的源文件当前内容", "", fileSection]
                    : []),
                  "",
                  "## 任务",
                  "",
                  "上面的失败来自刚生成的题目工作区。请定位根因并修复对应的源文件",
                  "（**只允许输出 src/ 下的 .cpp 文件，不要输出 config.json**）。常见根因：",
                  "- 编译错误：修复对应 .cpp 文件中的语法/未声明变量等问题。",
                  "- Unknown case type：generator 缺少该 type 的分支，补上。",
                  "- 数值范围违规：generator 生成的值超出题面范围，修正生成逻辑。",
                  "- validator 拒绝（Expected EOF/EOLN 等）：**generator 的输出行数或格式与 validator 的解析不一致**。",
                  "  以题面的输入格式为准：题面写几行，generator 就输出几行、validator 就读几行。",
                  "  通常是 generator 多输出/少输出了行，或 validator 少读了后续行——对照题面修正两者。",
                  "",
                  "**修编译错误时的硬性要求**：",
                  "- 只做**最小必要修改**，不要重写整个文件、不要改与报错无关的逻辑。",
                  "- 报错说某个名字「不是类类型 / 没有成员」，几乎总是**变量名遮蔽了 testlib 的全局对象**。",
                  "  testlib 已定义这些全局名，**绝对不能用作局部变量名**：",
                  "  `ans`（标准答案流）、`ouf`（选手输出流）、`inf`（输入流）、`rnd`（随机数）、",
                  "  `quitf`、`_ok`、`_wa`、`_pe`、`_fail`。",
                  "  典型错误：写 `double ans = ouf.readDouble();` 会遮蔽 `ans` 流，",
                  "  导致后面的 `ans.readDouble()` 编译失败。请改名为 `jury`、`contestant` 之类的名字。",
                  "- 修完请在心里把报错行重新读一遍，确认该名字不再被遮蔽。",
                  "",
                  "只修复失败信息指向的问题，不要重写无关文件。",
                  "修复后按输出格式输出完整的修改文件（仅 src/ 下的源文件）。",
                ].join("\n"),
              },
            ],
            { model: architectModel() },
          );

          if (!/NO_CHANGES_REQUIRED/.test(repairReply)) {
            const blocks = parseFileBlocks(repairReply).map(stripFencesFor);
            // The repair round only rewrites source files. config.json is
            // already valid at this point (it passed readConfig), and a
            // model-rewritten config reintroduces shape drift that breaks
            // validation - the exact failure mode this loop exists to fix.
            // Case-plan problems are fixed in generator.cpp instead.
            const writes = blocks.filter(
              (b: GeneratedFile) =>
                b.path.startsWith("src/") && !b.path.endsWith(".json"),
            );
            const skipped = blocks.filter(
              (b: GeneratedFile) => !writes.includes(b),
            );
            for (const skip of skipped) {
              log("verifier", `修复轮忽略非源文件：${skip.path}`);
            }
            const result = await writeGeneratedFiles(problemId, writes);
            for (const failure of result.failed) {
              log("verifier", `修复轮写入失败 ${failure.path}：${failure.error}`);
            }
            attempts.push({
              round: round + 1,
              digest,
              wrote: result.written,
            });
            // Re-run the preflight so the next round sees the errors that
            // remain, rather than the ones this round already fixed.
            try {
              compileDiagnostics = await preflightCompile(
                problemId,
                await readConfig(problemId),
              );
            } catch {
              // Keep the previous diagnostics; verification still decides.
            }
            log(
              "verifier",
              `第 ${round + 1} 轮修复完成，重写 ${result.written.length} 个文件，重新验题`,
            );
          } else {
            attempts.push({ round: round + 1, digest, wrote: [] });
            log("verifier", `第 ${round + 1} 轮修复：模型认为无需修改，重新验题`);
          }
        } catch (error) {
          log("verifier", `修复轮失败：${(error as Error).message}`);
          break;
        }
      }

      if (verification) {
        await patchMeta(problemId, { verification });
        if (verification.passed) {
          advance("verifier", "done", {
            summary: `通过 ${verification.passedCases} 个测试点`,
          });
        } else {
          advance("verifier", "failed", {
            summary: `${verification.failures.length} 项失败`,
            error: verification.failures
              .slice(0, 3)
              .map((f) => f.message)
              .join(" | "),
          });
          log(
            "verifier",
            `验题未通过，完整日志：verify-logs/${verification.logPath ?? ""}`,
          );
        }
      }
    } else {
      advance("verifier", "skipped", {
        summary: "RUN_VERIFICATION=0，已跳过",
      });
    }

    /* ---------------- dataset capture ---------------- */

    // Only verified runs teach the right thing, so capture happens after the
    // verifier had its say. Skipped verification counts as unverified.
    const verifiedStage = stages.find((s) => s.role === "verifier");
    const passed =
      verifiedStage?.status === "done" &&
      (await readIfPresent(problemId, "meta.json")) !== "";
    if (passed) {
      for (const exchange of captured) {
        await captureSample({
          capturedAt: nowIso(),
          role: exchange.role,
          slug: problemId.replace("/", "-"),
          difficulty: brief.difficulty,
          verified: true,
          system: exchange.system,
          user: exchange.user,
          assistant: exchange.assistant,
        });
      }
      log(
        "verifier",
        `已采集 ${captured.length} 条训练样本到 training/dataset/${problemId.replace("/", "-")}.jsonl`,
      );
    }
  } catch (error) {
    const message =
      error instanceof LlmError ? error.message : (error as Error).message;
    for (const s of stages) {
      if (s.status === "running") {
        s.status = "failed";
        s.error = message;
        s.finishedAt = nowIso();
      }
    }
    run.status = "failed";
    run.finishedAt = nowIso();
    emit({ type: "error", runId, message });
    return run;
  }

  run.status = stages.some((s) => s.status === "failed") ? "failed" : "done";
  run.finishedAt = nowIso();
  emit({ type: "done", run });
  return run;
}

export { FILE_BLOCK_CLOSE, FILE_BLOCK_OPEN };