import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  categoryDir,
  problemDir,
  problemPath,
  problemsDir,
} from "@/lib/paths";
import {
  problemConfigSchema,
  problemMetaSchema,
  type ProblemConfig,
  type ProblemMeta,
} from "@/lib/problems/schema";
import { removeProblemRecord } from "@/lib/problems/category";

/**
 * Filesystem backed problem registry.
 *
 * A problem lives at problems/<category>/<category>-<number>/ in the layout
 * the icpc-problem-creator skill expects. config.json is written and read by
 * the skill's own scripts, so we never rewrite it from the app. meta.json is
 * ours. The category directory also carries an index.json (see category.ts),
 * but the registry below reads problems directly so a hand-placed workspace
 * without an index entry still shows up.
 */

export type ProblemSummary = {
  /** Full problem id, e.g. "dp/dp-001". */
  problemId: string;
  /** Category slug, e.g. "dp". */
  category: string;
  /** Directory name, e.g. "dp-001". */
  dir: string;
  title: string;
  difficulty: ProblemMeta["difficulty"];
  tags: string[];
  interactive: boolean;
  timeLimitMs: number;
  memoryLimitMb: number;
  caseCount: number;
  solutionCount: number;
  wrongSolutionCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  /** Last verification verdict, null when never verified. */
  verified: boolean | null;
  /** True once a user submission passed every test case. */
  solved: boolean;
};

export type ProblemDetail = {
  summary: ProblemSummary;
  config: ProblemConfig;
  meta: ProblemMeta;
};

const CONFIG_FILE = "config.json";
const META_FILE = "meta.json";

async function readJson(file: string): Promise<unknown> {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw) as unknown;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * A meta.json we can synthesise for a workspace that predates the app.
 *
 * The skill has been used to build problems before this UI existed, and those
 * directories carry a perfectly good config.json but no meta.json. Rather than
 * hide them, derive the minimum the console needs and flag them as unverified.
 */
function fallbackMeta(config: ProblemConfig, problemId: string): ProblemMeta {
  const now = new Date().toISOString();
  return {
    slug: config.slug || problemId,
    title: config.title,
    difficulty: "中档",
    tags: config.interactive ? ["交互"] : [],
    premise: "",
    expectedApproach: "",
    complexity: "",
    inputFormat: "",
    outputFormat: "",
    createdAt: now,
    updatedAt: now,
    verification: null,
    solved: false,
  };
}

async function loadMeta(
  config: ProblemConfig,
  problemId: string,
): Promise<ProblemMeta> {
  const metaPath = path.join(problemDir(problemId), META_FILE);
  if (await pathExists(metaPath)) {
    const parsed = problemMetaSchema.safeParse(await readJson(metaPath));
    if (parsed.success) {
      return parsed.data;
    }
  }
  return fallbackMeta(config, problemId);
}

function toSummary(
  problemId: string,
  config: ProblemConfig,
  meta: ProblemMeta,
): ProblemSummary {
  const [category, dir] = problemId.split("/");
  return {
    problemId,
    category: category ?? problemId,
    dir: dir ?? problemId,
    title: config.title,
    difficulty: meta.difficulty,
    tags: meta.tags,
    interactive: config.interactive,
    timeLimitMs: config.timeLimitMs,
    memoryLimitMb: config.memoryLimitMb,
    caseCount: config.generator.cases.length,
    solutionCount: config.solutions.length,
    wrongSolutionCount: config.wrongSolutions.length,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    verified: meta.verification ? meta.verification.passed : null,
    solved: meta.solved,
  };
}

/**
 * Read every problem workspace, grouped by category.
 *
 * A workspace with an unreadable or invalid config.json is reported as a
 * problem with `null` fields rather than crashing the list, because a single
 * broken directory must not hide every other problem in the registry.
 */
export type RegistryEntry = {
  summary: ProblemSummary | null;
  /** Populated when the workspace exists but cannot be parsed. */
  error: string | null;
  problemId: string;
};

export type CategoryGroup = {
  category: string;
  label: string;
  entries: RegistryEntry[];
};

export async function listProblems(): Promise<CategoryGroup[]> {
  let categories: string[];
  try {
    const dirents = await fs.readdir(problemsDir, { withFileTypes: true });
    categories = dirents
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith(".") && !name.startsWith("_"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const groups: CategoryGroup[] = [];
  for (const category of categories) {
    const group: CategoryGroup = { category, label: "", entries: [] };

    // Category label comes from index.json when present.
    try {
      const raw = await fs.readFile(
        path.join(categoryDir(category), "index.json"),
        "utf8",
      );
      const parsed = JSON.parse(raw) as { label?: unknown };
      if (typeof parsed.label === "string") {
        group.label = parsed.label;
      }
    } catch {
      // No index: the category label stays empty.
    }

    let problemDirs: string[];
    try {
      const dirents = await fs.readdir(categoryDir(category), {
        withFileTypes: true,
      });
      problemDirs = dirents
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith(".") && !name.startsWith("_"));
    } catch {
      continue;
    }

    for (const dir of problemDirs) {
      const problemId = `${category}/${dir}`;
      try {
        const config = problemConfigSchema.parse(
          await readJson(path.join(problemDir(problemId), CONFIG_FILE)),
        );
        const meta = await loadMeta(config, problemId);
        group.entries.push({
          problemId,
          summary: toSummary(problemId, config, meta),
          error: null,
        });
      } catch (error) {
        const message =
          error instanceof z.ZodError
            ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
            : (error as Error).message;
        group.entries.push({ problemId, summary: null, error: message });
      }
    }

    group.entries.sort((a, b) => a.problemId.localeCompare(b.problemId));
    groups.push(group);
  }

  return groups.sort((a, b) => a.category.localeCompare(b.category));
}

export async function readProblem(
  problemId: string,
): Promise<ProblemDetail | null> {
  const parts = problemId.split("/");
  if (parts.length !== 2 || !parts.every((p) => p.length > 0)) {
    return null;
  }
  const configPath = path.join(problemDir(problemId), CONFIG_FILE);
  if (!(await pathExists(configPath))) {
    return null;
  }
  let config: ProblemConfig;
  try {
    config = problemConfigSchema.parse(await readJson(configPath));
  } catch (error) {
    // A workspace whose config.json fails validation is a failed generation,
    // not a missing problem. Surface a readable error instead of a 500.
    const message =
      error instanceof z.ZodError
        ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : (error as Error).message;
    throw new Error(
      `config.json 校验失败（${message}）。这道题是失败生成的残留，` +
        `可在造题页用相同分类重新生成，或手动删除该目录。`,
    );
  }
  const meta = await loadMeta(config, problemId);
  return {
    config,
    meta,
    summary: toSummary(problemId, config, meta),
  };
}

export async function writeMeta(
  problemId: string,
  meta: ProblemMeta,
): Promise<void> {
  const target = path.join(problemDir(problemId), META_FILE);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

/**
 * Persist a patch onto meta.json.
 *
 * The verification stage calls this after every run, so the read-modify-write
 * happens here rather than at each call site.
 */
export async function patchMeta(
  problemId: string,
  patch: Partial<ProblemMeta>,
): Promise<ProblemMeta> {
  const detail = await readProblem(problemId);
  if (!detail) {
    throw new Error(`workspace not found: ${problemId}`);
  }
  const next: ProblemMeta = {
    ...detail.meta,
    ...patch,
    slug: problemId.split("/")[1] ?? problemId,
    updatedAt: new Date().toISOString(),
  };
  const parsed = problemMetaSchema.parse(next);
  await writeMeta(problemId, parsed);
  return parsed;
}

/** Read a workspace text file, returning null when absent. */
export async function readWorkspaceFile(
  problemId: string,
  relative: string,
): Promise<string | null> {
  const parts = problemId.split("/");
  if (parts.length !== 2) {
    return null;
  }
  try {
    return await fs.readFile(problemPath(problemId, relative), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Delete a problem workspace and remove it from its category index.
 *
 * Used to clean up failed generations. The workspace directory is removed
 * outright (it only ever contains pipeline output), and the category index
 * drops the entry so the next generation in the category can reuse the
 * number. An empty category directory is left in place - the registry
 * renders it as an empty group, which is honest.
 */
export async function deleteProblem(problemId: string): Promise<void> {
  const parts = problemId.split("/");
  if (parts.length !== 2 || !parts.every((p) => p.length > 0)) {
    throw new Error(`题目 id 应为 <分类>/<目录> 两级: ${problemId}`);
  }
  const category = parts[0] as string;
  const dir = parts[1] as string;

  const target = problemDir(problemId);
  await fs.rm(target, { recursive: true, force: true });

  // Drop the index entry under the same cross-process lock as allocation.
  try {
    await removeProblemRecord(category, dir);
  } catch {
    // No index or unreadable: the directory removal is the important part.
  }
}
