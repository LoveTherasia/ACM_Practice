import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

const LOCK_DIR = ".index.lock";
const RESERVATION_FILE = ".allocation.json";
const LOCK_TIMEOUT_MS = 30_000;
const STALE_LOCK_MS = 10 * 60_000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cross-process category lock based on atomic directory creation.
 *
 * Node mutexes only protect one process. mkdir is atomic at the filesystem
 * level, so this also covers concurrent Next.js workers and two app instances
 * sharing the same problems directory. A stale lock is reclaimed after ten
 * minutes to make crashes recoverable.
 */
async function withCategoryLock<T>(
  category: string,
  task: () => Promise<T>,
): Promise<T> {
  if (!isValidCategory(category)) {
    throw new Error(`分类名不合法: ${category}`);
  }
  const root = categoryDir(category);
  await fs.mkdir(root, { recursive: true });
  const lock = path.join(root, LOCK_DIR);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await fs.mkdir(lock);
      await fs.writeFile(
        path.join(lock, "owner.json"),
        `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
        "utf8",
      );
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const stat = await fs.stat(lock);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          await fs.rm(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`等待分类 ${category} 的编号锁超时`);
      }
      await delay(25 + Math.floor(Math.random() * 50));
    }
  }

  try {
    return await task();
  } finally {
    await fs.rm(lock, { recursive: true, force: true }).catch(() => {});
  }
}

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
): Promise<{
  problemId: string;
  dir: string;
  index: CategoryIndex;
  reservationId: string;
}> {
  return withCategoryLock(category, async () => {
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
      // Category directory was removed between lock acquisition and scan.
    }

    // The lock serialises the scan, and the reservation directory keeps the
    // number occupied after the lock is released while the LLM run proceeds.
    const number = max + 1;
    const dir = `${category}-${String(number).padStart(3, "0")}`;
    const reservationId = randomUUID();
    const target = path.join(categoryDir(category), dir);
    await fs.mkdir(target); // no recursive/force: a collision is a hard failure
    await fs.writeFile(
      path.join(target, RESERVATION_FILE),
      `${JSON.stringify({ reservationId, createdAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    return {
      problemId: `${category}/${dir}`,
      dir,
      index,
      reservationId,
    };
  });
}

export async function assertProblemReservation(
  problemId: string,
  reservationId: string,
): Promise<void> {
  const [category, dir] = problemId.split("/");
  if (!category || !dir || !isValidCategory(category) || !new RegExp(`^${category}-\\d+$`).test(dir)) {
    throw new Error(`题目 id 不合法: ${problemId}`);
  }
  const raw = await fs.readFile(
    path.join(categoryDir(category), dir, RESERVATION_FILE),
    "utf8",
  );
  const current = JSON.parse(raw) as { reservationId?: string };
  if (current.reservationId !== reservationId) {
    throw new Error(`题目编号占位不属于当前生成任务: ${problemId}`);
  }
}

export async function consumeProblemReservation(problemId: string): Promise<void> {
  const [category, dir] = problemId.split("/");
  if (!category || !dir || !isValidCategory(category) || !new RegExp(`^${category}-\\d+$`).test(dir)) {
    throw new Error(`题目 id 不合法: ${problemId}`);
  }
  await fs.rm(path.join(categoryDir(category), dir, RESERVATION_FILE), { force: true });
}

/** Record a completed problem into its category index. */
export async function recordProblem(
  category: string,
  entry: CategoryEntry,
): Promise<void> {
  await withCategoryLock(category, async () => {
    const index = await readCategoryIndex(category);
    index.problems = index.problems.filter((p) => p.dir !== entry.dir);
    index.problems.push(entry);
    index.problems.sort((a, b) => a.dir.localeCompare(b.dir));
    await writeCategoryIndex(index);
  });
}

export async function removeProblemRecord(
  category: string,
  dir: string,
): Promise<void> {
  await withCategoryLock(category, async () => {
    const index = await readCategoryIndex(category);
    index.problems = index.problems.filter((entry) => entry.dir !== dir);
    await writeCategoryIndex(index);
  });
}
