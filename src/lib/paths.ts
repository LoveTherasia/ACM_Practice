import path from "node:path";

/**
 * Filesystem anchors.
 *
 * The vendored icpc-problem-creator toolchain is PowerShell based and expects to
 * be invoked from the repository root, and problem workspaces are plain
 * directories on disk (config.json is the single source of truth per the skill's
 * own rules). So the app reads and writes the filesystem directly rather than a
 * database. Every path is overridable so the app can be pointed at a checkout
 * elsewhere.
 *
 * Layout (two levels, category then problem):
 *
 *   problems/<category>/<category>-<number>/
 *
 * A category ("dp", "graph") is a directory of problems. Each problem gets an
 * auto-incrementing number inside its category (dp-001, dp-002, ...). The
 * category directory carries an index.json describing every problem in it,
 * so the registry can render a grouped view without opening every config.
 */

const repoRoot = process.cwd();

function resolveAnchor(envKey: string, fallbackRelative: string): string {
  const raw = process.env[envKey];
  if (!raw || raw.trim() === "") {
    return path.resolve(repoRoot, fallbackRelative);
  }
  return path.isAbsolute(raw)
    ? raw
    : path.resolve(repoRoot, raw.trim());
}

/** Root that holds one directory per problem category. */
export const problemsDir = resolveAnchor("PROBLEMS_DIR", "problems");

/** Root of the vendored agent skills. */
export const skillsDir = resolveAnchor("SKILLS_DIR", "skills");

/** The icpc-problem-creator skill root. */
export const icpcSkillDir = path.join(skillsDir, "icpc-problem-creator");

/** Slugs are used as directory names, so keep them boring on purpose. */
export const CATEGORY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidCategory(category: string): boolean {
  return CATEGORY_PATTERN.test(category) && category.length <= 64;
}

/** A full problem id like "dp/dp-003". */
export function problemDir(problemId: string): string {
  return path.join(problemsDir, ...problemId.split("/"));
}

/** The category directory, e.g. problems/dp. */
export function categoryDir(category: string): string {
  return path.join(problemsDir, category);
}

/** The index file inside a category directory. */
export function categoryIndexPath(category: string): string {
  return path.join(categoryDir(category), "index.json");
}

/**
 * Path to a file inside a problem workspace, with containment enforced.
 *
 * The problem id and relative path both reach us from LLM output and HTTP
 * input, so this is the single choke point that stops a crafted path from
 * escaping the workspace directory.
 */
export function problemPath(problemId: string, relative: string): string {
  const base = problemDir(problemId);
  const target = path.resolve(base, relative);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (target !== base && !target.startsWith(prefix)) {
    throw new Error(`path escapes the workspace: ${relative}`);
  }
  return target;
}

/** Render an absolute path back as workspace-relative, slash separated. */
export function relativeFromWorkspace(
  problemId: string,
  absolute: string,
): string {
  return path.relative(problemDir(problemId), absolute).split(path.sep).join("/");
}
