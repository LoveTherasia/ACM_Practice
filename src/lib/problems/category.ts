import { promises as fs } from "node:fs";
import { z } from "zod";

import { categoryDir, categoryIndexPath, isValidCategory } from "@/lib/paths";

/**
 * Category index management.
 *
 * Each category directory (problems/dp/) carries an index.json that records
 * every problem generated under it: its number, title, difficulty and tags.
 * The index is the authority for allocating the next number, so concurrent
 * generations inside one category cannot collide (the pipeline is serial per
 * process, and the allocation happens before any LLM call).
 */

export const categoryEntrySchema = z.object({
  /** The problem's directory name, e.g. "dp-001". */
  dir: z.string().min(1),
  /** Human title of the problem. */
  title: z.string().min(1),
  difficulty: z.string().min(1),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
});

export const categoryIndexSchema = z.object({
  category: z.string().min(1),
  /** Human label for the category, e.g. "动态规划". */
  label: z.string().default(""),
  problems: z.array(categoryEntrySchema).default([]),
});

export type CategoryEntry = z.infer<typeof categoryEntrySchema>;
export type CategoryIndex = z.infer<typeof categoryIndexSchema>;

export function emptyIndex(category: string, label = ""): CategoryIndex {
  return { category, label, problems: [] };
}

export async function readCategoryIndex(
  category: string,
): Promise<CategoryIndex> {
  if (!isValidCategory(category)) {
    throw new Error(`分类名不合法: ${category}`);
  }
  try {
    const raw = await fs.readFile(categoryIndexPath(category), "utf8");
    const parsed = categoryIndexSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // Missing or malformed index: rebuild from an empty one.
  }
  return emptyIndex(category);
}

export async function writeCategoryIndex(index: CategoryIndex): Promise<void> {
  await fs.mkdir(categoryDir(index.category), { recursive: true });
  await fs.writeFile(
    categoryIndexPath(index.category),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Allocate the next problem number in a category and reserve its directory
 * name. Returns the problem id ("dp/dp-003") and the updated index.
 *
 * Numbering is 3-digit zero-padded, which sorts correctly up to 999 problems
 * per category - far beyond what one category should ever hold.
 */
export async function allocateProblem(
  category: string,
  label = "",
): Promise<{ problemId: string; dir: string; index: CategoryIndex }> {
  const index = await readCategoryIndex(category);
  if (label) {
    index.label = label;
  }

  let max = 0;
  for (const entry of index.problems) {
    const match = /^(\d+)$/.exec(entry.dir.replace(`${category}-`, ""));
    if (match) {
      max = Math.max(max, Number.parseInt(match[1] ?? "0", 10));
    }
  }

  // Also scan the directory itself: a crashed run may have left a directory
  // the index never recorded, and reusing its number would collide.
  try {
    const entries = await fs.readdir(categoryDir(category), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const match = new RegExp(`^${category}-(\\d+)$`).exec(entry.name);
      if (match) {
        max = Math.max(max, Number.parseInt(match[1] ?? "0", 10));
      }
    }
  } catch {
    // Category directory does not exist yet.
  }

  const number = max + 1;
  const dir = `${category}-${String(number).padStart(3, "0")}`;
  return { problemId: `${category}/${dir}`, dir, index };
}

/** Record a completed problem into its category index. */
export async function recordProblem(
  category: string,
  entry: CategoryEntry,
): Promise<void> {
  const index = await readCategoryIndex(category);
  index.problems = index.problems.filter((p) => p.dir !== entry.dir);
  index.problems.push(entry);
  index.problems.sort((a, b) => a.dir.localeCompare(b.dir));
  await writeCategoryIndex(index);
}
