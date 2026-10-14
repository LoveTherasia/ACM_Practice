import { describe, expect, it } from "vitest";

import { auditDataset, dedupeDataset } from "./audit";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * The audit reads training/dataset via repoRoot-relative paths, which the
 * test cannot redirect. These tests exercise the pure logic through a
 * temporary dataset by chdir-ing into a scratch repo layout - vitest runs
 * each file in its own process, so the cwd change is contained.
 */

async function withScratchDataset(
  lines: Record<string, unknown>[],
  task: (dir: string) => Promise<void>,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds-audit-"));
  await fs.mkdir(path.join(dir, "training", "dataset"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "training", "dataset", "test.jsonl"),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    "utf8",
  );  const oldCwd = process.cwd();
  process.chdir(dir);
  try {
    await task(dir);
  } finally {
    process.chdir(oldCwd);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const sample = (over: Record<string, unknown>) => ({
  capturedAt: "2026-01-01T00:00:00Z",
  role: "architect",
  slug: "test-test-001",
  difficulty: "中档",
  verified: true,
  system: "sys",
  user: "make a problem",
  assistant: "ok",
  ...over,
});

describe("dataset audit", () => {
  it("counts samples and reports distribution", async () => {
    await withScratchDataset(
      [
        sample({ slug: "dp-dp-001", difficulty: "简单" }),
        sample({ slug: "dp-dp-002", difficulty: "困难", role: "judge-validator", user: "write validator" }),
        sample({ slug: "graph-graph-001" }),
      ],
      async () => {
        const report = await auditDataset();
        expect(report.samples).toBe(3);
        expect(report.verified).toBe(3);
        expect(report.distribution.categories[0]?.category).toBe("dp");
        expect(report.distribution.categories[0]?.count).toBe(2);
        expect(report.distribution.roles).toHaveLength(2);
      },
    );
  });

  it("flags exact duplicates across slugs", async () => {
    await withScratchDataset(
      [
        sample({ slug: "dp-dp-001" }),
        sample({ slug: "graph-graph-001" }), // same role+user -> duplicate
        sample({ slug: "graph-graph-002", user: "different" }),
      ],
      async () => {
        const report = await auditDataset();
        expect(report.duplicates.count).toBe(1);
        expect(report.duplicates.groups).toHaveLength(1);
        expect(report.duplicates.groups[0]?.slugs).toContain("dp-dp-001");
      },
    );
  });

  it("flags near-duplicates with high shingle similarity", async () => {
    await withScratchDataset(
      [
        sample({ slug: "dp-dp-001", user: "please create a dynamic programming problem about trees with small constraints" }),
        sample({ slug: "dp-dp-002", user: "please create a dynamic programming problem about trees with small constraints and more" }),
        sample({ slug: "graph-graph-001", user: "write a shortest path problem on a grid with obstacles" }),
      ],
      async () => {
        const report = await auditDataset();
        expect(report.nearDuplicates.count).toBeGreaterThanOrEqual(1);
        expect(report.nearDuplicates.pairs[0]?.similarity).toBeGreaterThanOrEqual(0.8);
      },
    );
  });

  it("reports malformed lines", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds-audit-"));
    await fs.mkdir(path.join(dir, "training", "dataset"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "training", "dataset", "bad.jsonl"),
      '{"role":"x"}\nnot json at all\n',
      "utf8",
    );
    const oldCwd = process.cwd();
    process.chdir(dir);
    try {
      const report = await auditDataset();
      expect(report.malformed.length).toBeGreaterThanOrEqual(1);
    } finally {
      process.chdir(oldCwd);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("dedupeDataset", () => {
  it("removes exact duplicates, keeps the first", async () => {
    await withScratchDataset(
      [
        sample({ slug: "dp-dp-001", assistant: "first" }),
        sample({ slug: "graph-graph-001", assistant: "second" }), // dup
        sample({ slug: "graph-graph-002", user: "different" }),
      ],
      async (dir) => {
        const result = await dedupeDataset();
        expect(result.removed).toBe(1);
        const raw = await fs.readFile(
          path.join(dir, "training", "dataset", "test.jsonl"),
          "utf8",
        );
        const lines = raw.trim().split("\n").map((l) => JSON.parse(l));
        expect(lines).toHaveLength(2);
        expect(lines[0]?.assistant).toBe("first");
        // The audit now sees no duplicates.
        const report = await auditDataset();
        expect(report.duplicates.count).toBe(0);
      },
    );
  });
});
