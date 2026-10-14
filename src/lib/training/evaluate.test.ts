import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { evaluateModel, scoreReply } from "./evaluate";

async function withScratchDataset(
  lines: Record<string, unknown>[],
  task: () => Promise<void>,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds-eval-"));
  await fs.mkdir(path.join(dir, "training", "dataset"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "training", "dataset", "test.jsonl"),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    "utf8",
  );
  const oldCwd = process.cwd();
  process.chdir(dir);
  try {
    await task();
  } finally {
    process.chdir(oldCwd);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const gold = (files: Record<string, string>) =>
  Object.entries(files)
    .map(([p, c]) => `<<<FILE ${p}>>>\n${c}\n<<<END>>>`)
    .join("\n");

const sample = (over: Record<string, unknown>) => ({
  capturedAt: "2026-01-01T00:00:00Z",
  role: "architect",
  slug: "a-a-001",
  difficulty: "中档",
  verified: true,
  system: "you are the architect",
  user: "make a problem about trees",
  assistant: gold({ "config.json": "{}", "docs/statement.md": "# T" }),
  ...over,
});

describe("scoreReply", () => {
  it("matches when the file set is identical", () => {
    const reply = gold({ "config.json": "{ }", "docs/statement.md": "# Other" });
    const s = scoreReply(reply, sample({}).assistant);
    expect(s.answered).toBe(true);
    expect(s.parseOk).toBe(true);
    expect(s.fileSetMatch).toBe(true);
    expect(s.missing).toEqual([]);
    expect(s.extra).toEqual([]);
  });

  it("reports a missing file", () => {
    const reply = gold({ "config.json": "{}" });
    const s = scoreReply(reply, sample({}).assistant);
    expect(s.fileSetMatch).toBe(false);
    expect(s.missing).toEqual(["docs/statement.md"]);
  });

  it("flags a reply that ignored the protocol", () => {
    const s = scoreReply("here is the config: {}", sample({}).assistant);
    expect(s.parseOk).toBe(false);
    expect(s.fileSetMatch).toBe(false);
  });

  it("gives high similarity to a near-identical reply", () => {
    const g = sample({}).assistant;
    expect(scoreReply(g, g).similarity).toBe(1);
  });
});

describe("evaluateModel", () => {
  it("scores each sample and aggregates by role", async () => {
    await withScratchDataset(
      [
        sample({ slug: "a-a-001", role: "architect" }),
        sample({
          slug: "a-a-002",
          role: "judge-validator",
          system: "you are the judge-validator",
          user: "write the validator and generator",
          assistant: gold({ "src/validator/validator.cpp": "int main(){}" }),
        }),
      ],
      async () => {
        // Model reproduces the gold exactly.
        const report = await evaluateModel({ model: "fake" }, async (messages) => {
          const system = messages.find((m) => m.role === "system")?.content ?? "";
          return system.includes("judge")
            ? gold({ "src/validator/validator.cpp": "int main(){}" })
            : gold({ "config.json": "{}", "docs/statement.md": "# T" });
        });
        expect(report.model).toBe("fake");
        expect(report.evaluated).toBe(2);
        expect(report.answeredRate).toBe(1);
        expect(report.parseRate).toBe(1);
        expect(report.fileSetMatchRate).toBe(1);
        expect(report.byRole.map((r) => r.role)).toEqual(["architect", "judge-validator"]);
      },
    );
  });

  it("records per-sample errors without aborting the run", async () => {
    await withScratchDataset([sample({}), sample({ slug: "a-a-002" })], async () => {
      let call = 0;
      const report = await evaluateModel({}, async () => {
        call += 1;
        if (call === 1) throw new Error("connection refused");
        return sample({}).assistant;
      });
      expect(report.evaluated).toBe(2);
      expect(report.answeredRate).toBe(0.5);
      expect(report.samples[0]?.error).toContain("connection refused");
    });
  });

  it("skips placeholders by default and can include them", async () => {
    await withScratchDataset(
      [
        sample({ slug: "real-001" }),
        sample({
          slug: "placeholder-001",
          role: "judge-validator",
          system: "(retro-captured: system prompt for judge-validator)",
          user: "(retro-captured: user brief for judge-validator)",
        }),
      ],
      async () => {
        const run = async () => sample({}).assistant;
        expect((await evaluateModel({}, run)).evaluated).toBe(1);
        expect(
          (await evaluateModel({ includePlaceholders: true }, run)).evaluated,
        ).toBe(2);
      },
    );
  });

  it("honours limit and role filters", async () => {
    await withScratchDataset(
      [
        sample({ slug: "a-a-001", role: "architect" }),
        sample({ slug: "a-a-002", role: "architect" }),
        sample({ slug: "a-a-003", role: "judge-validator" }),
      ],
      async () => {
        const run = async () => sample({}).assistant;
        expect((await evaluateModel({ limit: 1 }, run)).evaluated).toBe(1);
        const byRole = await evaluateModel({ role: "architect" }, run);
        expect(byRole.evaluated).toBe(2);
        expect(byRole.samples.every((s) => s.role === "architect")).toBe(true);
      },
    );
  });
});
