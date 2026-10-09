import { promises as fs } from "node:fs";
import path from "node:path";

import { repoRoot } from "@/lib/settings/env-file";

/**
 * Training dataset accumulation.
 *
 * Route B of the local-model plan: every successful cloud generation becomes
 * a supervised fine-tuning sample. The dataset lives in training/dataset/ as
 * JSONL, one file per problem, so the corpus can be inspected, deduplicated
 * and version-controlled before any training run.
 *
 * A sample pairs the exact prompt the pipeline sent to a role with the exact
 * reply that passed verification. That is the whole point: we only keep
 * outputs that survived run-all-tests.ps1, so the fine-tuned model learns
 * from verified-correct generations, not from anything the model happened
 * to say.
 */

export type TrainingSample = {
  /** ISO timestamp of the generation run. */
  capturedAt: string;
  /** Pipeline role that produced this exchange. */
  role: string;
  /** The slug of the problem this sample belongs to. */
  slug: string;
  /** Difficulty as declared in the brief. */
  difficulty: string;
  /** Whether the final verification for this run passed. */
  verified: boolean;
  /** The system prompt, verbatim. */
  system: string;
  /** The user prompt, verbatim. */
  user: string;
  /** The assistant reply, verbatim. */
  assistant: string;
};

export function datasetDir(): string {
  return path.join(repoRoot, "training", "dataset");
}

/**
 * Append one sample to the dataset.
 *
 * Failures are swallowed deliberately: dataset capture must never break a
 * generation run. A missing training/ directory just means capture is off.
 */
export async function captureSample(sample: TrainingSample): Promise<void> {
  try {
    const dir = datasetDir();
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${sample.slug}.jsonl`);
    const line = JSON.stringify(sample);
    await fs.appendFile(file, `${line}\n`, "utf8");
  } catch {
    // Capture is best-effort by design.
  }
}

/** Count captured samples, for the settings page readout. */
export async function countSamples(): Promise<{
  files: number;
  samples: number;
  verified: number;
}> {
  let files = 0;
  let samples = 0;
  let verified = 0;
  try {
    const entries = await fs.readdir(datasetDir(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }
      files += 1;
      const raw = await fs.readFile(
        path.join(datasetDir(), entry.name),
        "utf8",
      );
      for (const line of raw.split("\n")) {
        // Strip a UTF-8 BOM that an external editor may have left behind.
        const cleaned = line.replace(/^\uFEFF/, "");
        if (!cleaned.trim()) {
          continue;
        }
        samples += 1;
        try {
          const parsed = JSON.parse(cleaned) as { verified?: boolean };
          if (parsed.verified) {
            verified += 1;
          }
        } catch {
          // A malformed line still counts as a sample.
        }
      }
    }
  } catch {
    // No dataset yet.
  }
  return { files, samples, verified };
}
