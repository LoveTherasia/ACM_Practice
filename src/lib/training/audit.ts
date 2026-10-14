import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { datasetDir, type TrainingSample } from "@/lib/training/dataset";/**
 * Dataset quality audit and deduplication.
 *
 * The corpus grows by appending whatever the pipeline captured, with no
 * cross-file view. Two failure modes accumulate silently:
 *
 * 1. DUPLICATES: the same (role, user prompt) captured twice - a re-run of
 *    the same brief, a retro-capture after a manual fix, or a model reply
 *    so templated that different problems produce near-identical prompts.
 *    Fine-tuning on duplicates over-weights those patterns.
 *
 * 2. DISTRIBUTION SKEW: 49 samples that are 60% "graph/最短路" teach the
 *    model one kind of problem. The audit surfaces the category x
 *    difficulty matrix so the next generation batch can target the gaps.
 *
 * The audit is read-only; dedupeDataset() rewrites the files in place
 * (keeping the first occurrence of each duplicate group) after the report
 * has been reviewed.
 */

export type DatasetAudit = {
  files: number;
  samples: number;
  verified: number;
  /** Exact duplicates: identical (role, user) hash. */
  duplicates: {
    count: number;
    /** Grouped by hash, only groups of size > 1. */
    groups: { hash: string; slugs: string[]; role: string }[];
  };
  /** Near-duplicates: same role and Jaccard-similarity >= 0.8 on user shingles. */
  nearDuplicates: {
    count: number;
    pairs: { a: string; b: string; similarity: number }[];
  };
  /** Category x difficulty matrix (from the slug prefix). */
  distribution: {
    categories: { category: string; count: number; byDifficulty: Record<string, number> }[];
    roles: { role: string; count: number }[];
  };
  /** Samples whose fields are malformed (empty prompts, bad JSON). */
  malformed: { file: string; line: number; reason: string }[];
  /**
   * Samples with no real prompt (retro-capture placeholders). They carry no
   * usable (prompt -> reply) signal and should be pruned before fine-tuning.
   */
  placeholders: { count: number };
};

/**
 * The generic retro-capture placeholder.
 *
 * The "retro-captured" convention fills system/user with a fixed string that is
 * identical for EVERY problem, so the real prompt is simply absent from the file.
 * A sample built on it teaches the model to answer a placeholder, not the task.
 */
const PLACEHOLDER_TEXT = /^\(\s*retro-captured\b/i;

/** Whether a single prompt field is the retro-capture placeholder. */
export function isPlaceholderText(text: string | null | undefined): boolean {
  return PLACEHOLDER_TEXT.test((text ?? "").trim());
}

/**
 * A sample with no real prompt: an empty user, or the retro-capture placeholder
 * standing in for either field.
 */
export function isPlaceholderSample(
  sample: Partial<Pick<TrainingSample, "system" | "user">>,
): boolean {
  return (
    (sample.user ?? "").trim() === "" ||
    isPlaceholderText(sample.user) ||
    isPlaceholderText(sample.system)
  );
}

/**
 * Identity used for duplicate detection.
 *
 * A real sample is identified by (role, user): the same role given the same
 * prompt is the same teaching signal, even across problems. A retro-captured
 * placeholder has that same generic prompt for EVERY problem, so a (role, user)
 * identity collapses them all into one group - and dedupeDataset, which keeps
 * only the first occurrence, then deletes every later problem's verified data
 * wholesale (observed: graph-graph-006.jsonl reduced from 3 samples to a 1-byte
 * empty file). Namespacing a placeholder by its slug makes it a duplicate only
 * of itself.
 */
function sampleIdentity(
  sample: Pick<TrainingSample, "slug" | "role" | "user" | "system">,
): string {
  if (isPlaceholderSample(sample)) {
    return `${sample.slug ?? ""}\u0000${sample.role}\u0000${sample.user}`;
  }
  return `${sample.role}\u0000${sample.user}`;
}

/** Hash a sample's identity: same role + same user prompt = same teaching signal. */
function sampleHash(
  sample: Pick<TrainingSample, "slug" | "role" | "user" | "system">,
): string {
  return createHash("sha256")
    .update(sampleIdentity(sample))
    .digest("hex")
    .slice(0, 16);
}

/** Shingle a text into word 3-grams for near-duplicate detection. */
function shingles(text: string): Set<string> {
  const words = text.split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i += 1) {
    out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  if (words.length < 3 && words.length > 0) {
    out.add(words.join(" "));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter += 1;
  }
  return inter / (a.size + b.size - inter);
}

/** Read every sample in the dataset, with its file and line for reporting. */
async function readAll(): Promise<
  { sample: TrainingSample; file: string; line: number }[]
> {
  const out: { sample: TrainingSample; file: string; line: number }[] = [];
  const dir = datasetDir();
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const raw = await fs
      .readFile(path.join(dir, entry.name), "utf8")
      .catch(() => "");
    let lineNo = 0;
    for (const line of raw.split("\n")) {
      lineNo += 1;
      const cleaned = line.replace(/^\uFEFF/, "");
      if (!cleaned.trim()) continue;
      try {
        out.push({
          sample: JSON.parse(cleaned) as TrainingSample,
          file: entry.name,
          line: lineNo,
        });
      } catch {
        // Malformed lines are reported by the audit, not parsed.
      }
    }
  }
  return out;
}

/** Audit the dataset: duplicates, near-duplicates, distribution, malformed lines. */
export async function auditDataset(): Promise<DatasetAudit> {
  const all = await readAll();

  // Collect malformed lines separately (readAll skips them).
  const malformed: { file: string; line: number; reason: string }[] = [];
  const entries = await fs.readdir(datasetDir(), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const raw = await fs
      .readFile(path.join(datasetDir(), entry.name), "utf8")
      .catch(() => "");
    let lineNo = 0;
    for (const line of raw.split("\n")) {
      lineNo += 1;
      const cleaned = line.replace(/^\uFEFF/, "");
      if (!cleaned.trim()) continue;
      try {
        const parsed = JSON.parse(cleaned) as Partial<TrainingSample>;
        if (typeof parsed.user !== "string" || parsed.user.trim() === "") {
          malformed.push({ file: entry.name, line: lineNo, reason: "user prompt 为空" });
        } else if (typeof parsed.assistant !== "string" || parsed.assistant.trim() === "") {
          malformed.push({ file: entry.name, line: lineNo, reason: "assistant 回复为空" });
        }
      } catch {
        malformed.push({ file: entry.name, line: lineNo, reason: "JSON 解析失败" });
      }
    }
  }

  // Exact duplicates by (role, user) hash.
  const byHash = new Map<string, { slugs: string[]; role: string }>();
  for (const { sample } of all) {
    const hash = sampleHash(sample);
    const group = byHash.get(hash) ?? { slugs: [], role: sample.role };
    if (!group.slugs.includes(sample.slug)) group.slugs.push(sample.slug);
    byHash.set(hash, group);
  }
  const dupGroups = [...byHash.entries()]
    .filter(([, g]) => g.slugs.length > 1)
    .map(([hash, g]) => ({ hash, slugs: g.slugs, role: g.role }));
  const duplicateCount =
    dupGroups.reduce((s, g) => s + g.slugs.length - 1, 0);

  // Near-duplicates: same role, Jaccard >= 0.9. O(n^2) is fine for the
  // current corpus size (dozens); revisit if it crosses thousands.
  const nearPairs: { a: string; b: string; similarity: number }[] = [];
  const shingleCache = all.map(({ sample }) => ({
    slug: sample.slug ?? "unknown",
    role: sample.role ?? "unknown",
    sh: shingles(sample.user ?? ""),
    placeholder: isPlaceholderSample(sample),
  }));
  for (let i = 0; i < shingleCache.length; i += 1) {
    for (let j = i + 1; j < shingleCache.length; j += 1) {
      const a = shingleCache[i]!;
      const b = shingleCache[j]!;
      // Placeholder prompts are identical by construction; comparing them only
      // manufactures fake near-duplicates.
      if (a.placeholder || b.placeholder) continue;
      if (a.role !== b.role || a.slug === b.slug) continue;
      const sim = jaccard(a.sh, b.sh);
      if (sim >= 0.8) {
        nearPairs.push({ a: a.slug, b: b.slug, similarity: sim });
      }
    }
  }

  // Distribution: category from the slug prefix (before the last '-'),
  // difficulty from the sample.
  const catMap = new Map<string, Map<string, number>>();
  for (const { sample } of all) {
    const category = (sample.slug ?? "unknown").split("-")[0] ?? "unknown";
    const diff = sample.difficulty || "未标注";
    const byDiff = catMap.get(category) ?? new Map<string, number>();
    byDiff.set(diff, (byDiff.get(diff) ?? 0) + 1);
    catMap.set(category, byDiff);
  }
  const categories = [...catMap.entries()]
    .map(([category, byDiff]) => ({
      category,
      count: [...byDiff.values()].reduce((s, v) => s + v, 0),
      byDifficulty: Object.fromEntries(byDiff),
    }))
    .sort((a, b) => b.count - a.count);

  const roleMap = new Map<string, number>();
  for (const { sample } of all) {
    roleMap.set(sample.role, (roleMap.get(sample.role) ?? 0) + 1);
  }
  const roles = [...roleMap.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count);

  return {
    files: entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).length,
    samples: all.length,
    verified: all.filter((s) => s.sample.verified).length,
    duplicates: { count: duplicateCount, groups: dupGroups },
    nearDuplicates: { count: nearPairs.length, pairs: nearPairs.slice(0, 20) },
    distribution: { categories, roles },
    malformed,
    placeholders: {
      count: all.filter((s) => isPlaceholderSample(s.sample)).length,
    },
  };
}

/**
 * Deduplicate the dataset in place.
 *
 * Keeps the FIRST occurrence of each exact-duplicate group (earlier runs
 * are closer to the original verified generation) and rewrites every jsonl
 * file. Returns how many lines were removed.
 */
export async function dedupeDataset(): Promise<{ removed: number }> {
  const entries = await fs.readdir(datasetDir(), { withFileTypes: true }).catch(() => []);
  const seenHashes = new Set<string>();
  let removed = 0;

  // Process files in name order so "first" is deterministic.
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => e.name)
    .sort();

  for (const name of files) {
    const file = path.join(datasetDir(), name);
    const raw = await fs.readFile(file, "utf8").catch(() => "");
    const kept: string[] = [];
    for (const line of raw.split("\n")) {
      const cleaned = line.replace(/^\uFEFF/, "");
      if (!cleaned.trim()) {
        if (line !== "") kept.push(line);
        continue;
      }
      try {
        const sample = JSON.parse(cleaned) as TrainingSample;
        const hash = sampleHash(sample);
        if (seenHashes.has(hash)) {
          removed += 1;
          continue;
        }
        seenHashes.add(hash);
        kept.push(cleaned);
      } catch {
        kept.push(cleaned); // Malformed lines are the audit's business.
      }
    }
    await fs.writeFile(file, `${kept.join("\n").replace(/\n+$/, "")}\n`, "utf8");
  }
  return { removed };
}

/**
 * Remove samples that carry no real prompt.
 *
 * A retro-captured placeholder ("(retro-captured: user brief for …)") is the
 * same string for every problem, so a sample built on it teaches the model to
 * answer a placeholder rather than the task - the assistant half may be real,
 * but the (prompt -> reply) pair the model learns from is not. Rewrites the
 * jsonl files in place and reports what was removed per file.
 */
export async function prunePlaceholderSamples(): Promise<{
  removed: number;
  files: { file: string; removed: number }[];
}> {
  const entries = await fs.readdir(datasetDir(), { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => e.name)
    .sort();

  const report: { file: string; removed: number }[] = [];
  let total = 0;
  for (const name of files) {
    const file = path.join(datasetDir(), name);
    const raw = await fs.readFile(file, "utf8").catch(() => "");
    const kept: string[] = [];
    let removed = 0;
    for (const line of raw.split("\n")) {
      const cleaned = line.replace(/^\uFEFF/, "");
      if (!cleaned.trim()) {
        if (line !== "") kept.push(line);
        continue;
      }
      try {
        const sample = JSON.parse(cleaned) as TrainingSample;
        if (isPlaceholderSample(sample)) {
          removed += 1;
          continue;
        }
        kept.push(cleaned);
      } catch {
        kept.push(cleaned); // Malformed lines are the audit's business.
      }
    }
    if (removed > 0) {
      await fs.writeFile(file, `${kept.join("\n").replace(/\n+$/, "")}\n`, "utf8");
      report.push({ file: name, removed });
      total += removed;
    }
  }
  return { removed: total, files: report };
}
