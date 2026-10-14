import { promises as fs } from "node:fs";
import path from "node:path";

import { complete, workerModel, type ChatMessage } from "@/lib/llm/provider";
import { parseFileBlocks } from "@/lib/llm/orchestrate";
import { datasetDir, type TrainingSample } from "@/lib/training/dataset";
import { isPlaceholderSample } from "@/lib/training/audit";

/**
 * Evaluate the currently configured model against the captured corpus.
 *
 * The dataset is a set of (system, user) -> assistant exchanges that a strong
 * model produced and the verifier accepted. Replaying those prompts against the
 * active model - a local fine-tune pointed at Ollama, or any other backend -
 * measures whether the distilled model reproduces the behaviour the corpus
 * teaches. This is the missing "验证和评估" step of the local-model route: the
 * fine-tune is otherwise only ever scored by the human noticing it is bad.
 *
 * Three scores per sample, cheapest first:
 *   1. answered  - the model produced a non-empty reply at all.
 *   2. parseOk   - the reply followed the <<<FILE ...>>> protocol (the pipeline
 *                  cannot use a reply that does not).
 *   3. fileMatch - the set of files it emitted equals the gold set. A reply that
 *                  produces config.json but not the generator is not usable even
 *                  if it reads well.
 * plus a token-Jaccard similarity to the gold reply as a coarse text signal.
 *
 * `complete` is injectable so tests run without a model; the default is the
 * active provider.
 */

export type EvalOptions = {
  /** Maximum samples to evaluate (cost control). Defaults to all. */
  limit?: number;
  /** Restrict to one pipeline role. */
  role?: string;
  /** Include placeholder samples (no real prompt). Off by default. */
  includePlaceholders?: boolean;
  /** Model id to evaluate; defaults to the configured worker model. */
  model?: string;
  signal?: AbortSignal;
};

export type EvalSampleResult = {
  slug: string;
  role: string;
  answered: boolean;
  parseOk: boolean;
  fileSetMatch: boolean;
  missing: string[];
  extra: string[];
  similarity: number;
  error: string | null;
};

export type EvalReport = {
  model: string;
  total: number;
  evaluated: number;
  answeredRate: number;
  parseRate: number;
  fileSetMatchRate: number;
  meanSimilarity: number;
  elapsedMs: number;
  byRole: {
    role: string;
    n: number;
    parseRate: number;
    fileSetMatchRate: number;
    meanSimilarity: number;
  }[];
  samples: EvalSampleResult[];
};

type EvalComplete = (
  messages: ChatMessage[],
  options?: { model?: string; signal?: AbortSignal },
) => Promise<string>;

/** Whitespace/punctuation tokens, clipped so one huge reply cannot dominate. */
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of text.slice(0, 4000).split(/[\s\W_]+/)) {
    if (token.length > 1) {
      out.add(token.toLowerCase());
    }
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter += 1;
  }
  return inter / (a.size + b.size - inter);
}

/** Normalise a file path for set comparison. */
function normPath(p: string): string {
  return p.replace(/^\.?\//, "").trim();
}

async function loadSamples(options: EvalOptions): Promise<TrainingSample[]> {
  const dir = datasetDir();
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const samples: TrainingSample[] = [];
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
    .map((e) => e.name)
    .sort();
  for (const name of files) {
    const raw = await fs.readFile(path.join(dir, name), "utf8").catch(() => "");
    for (const line of raw.split("\n")) {
      const cleaned = line.replace(/^\uFEFF/, "");
      if (!cleaned.trim()) continue;
      try {
        samples.push(JSON.parse(cleaned) as TrainingSample);
      } catch {
        // Malformed lines are the audit's business, not the evaluator's.
      }
    }
  }
  return samples.filter((s) => {
    if (!options.includePlaceholders && isPlaceholderSample(s)) return false;
    if (options.role && s.role !== options.role) return false;
    return true;
  });
}

/** Score one sample's reply against the gold assistant text. */
export function scoreReply(
  reply: string,
  gold: string,
): Omit<EvalSampleResult, "slug" | "role" | "error"> {
  const answered = reply.trim() !== "";
  const produced = parseFileBlocks(reply);
  const expected = parseFileBlocks(gold);
  const parseOk = produced.length > 0 || (expected.length === 0 && answered);

  const producedPaths = new Set(produced.map((f) => normPath(f.path)));
  const expectedPaths = new Set(expected.map((f) => normPath(f.path)));
  const missing = [...expectedPaths].filter((p) => !producedPaths.has(p)).sort();
  const extra = [...producedPaths].filter((p) => !expectedPaths.has(p)).sort();
  const fileSetMatch =
    expectedPaths.size === 0
      ? answered
      : missing.length === 0 && extra.length === 0;

  return {
    answered,
    parseOk,
    fileSetMatch,
    missing,
    extra,
    similarity: jaccard(tokens(reply), tokens(gold)),
  };
}

export async function evaluateModel(
  options: EvalOptions = {},
  runComplete: EvalComplete = complete,
): Promise<EvalReport> {
  const started = Date.now();
  const model = options.model ?? workerModel();

  let samples = await loadSamples(options);
  if (typeof options.limit === "number" && options.limit >= 0) {
    samples = samples.slice(0, options.limit);
  }

  const results: EvalSampleResult[] = [];
  for (const sample of samples) {
    const messages: ChatMessage[] = [
      { role: "system", content: sample.system },
      { role: "user", content: sample.user },
    ];
    try {
      const reply = await runComplete(messages, { model, signal: options.signal });
      results.push({
        slug: sample.slug,
        role: sample.role,
        error: null,
        ...scoreReply(reply, sample.assistant),
      });
    } catch (error) {
      results.push({
        slug: sample.slug,
        role: sample.role,
        answered: false,
        parseOk: false,
        fileSetMatch: false,
        missing: [],
        extra: [],
        similarity: 0,
        error: (error as Error).message,
      });
    }
  }

  const n = results.length;
  const mean = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;

  const roles = [...new Set(results.map((r) => r.role))].sort();
  const byRole = roles.map((role) => {
    const rows = results.filter((r) => r.role === role);
    return {
      role,
      n: rows.length,
      parseRate: mean(rows.map((r) => (r.parseOk ? 1 : 0))),
      fileSetMatchRate: mean(rows.map((r) => (r.fileSetMatch ? 1 : 0))),
      meanSimilarity: mean(rows.map((r) => r.similarity)),
    };
  });

  return {
    model,
    total: samples.length,
    evaluated: n,
    answeredRate: mean(results.map((r) => (r.answered ? 1 : 0))),
    parseRate: mean(results.map((r) => (r.parseOk ? 1 : 0))),
    fileSetMatchRate: mean(results.map((r) => (r.fileSetMatch ? 1 : 0))),
    meanSimilarity: mean(results.map((r) => r.similarity)),
    elapsedMs: Date.now() - started,
    byRole,
    samples: results,
  };
}
