import { promises as fs } from "node:fs";
import path from "node:path";

import { problemsDir } from "@/lib/paths";
import { listProblems } from "@/lib/problems/store";
import { preflightCompile } from "@/lib/problems/workspace";
import {
  problemConfigSchema,
  type ProblemConfig,
} from "@/lib/problems/schema";

/**
 * Failed-problem recycling.
 *
 * The registry currently carries 8 problems whose verification failed or
 * never ran. Each one was diagnosed by hand at some point, but the
 * diagnosis lived in a conversation and the workspace never got fixed.
 * Meanwhile the preflight suite has grown six checks (language, format,
 * type contract, sample sync, tree shape, case distinctness) that name
 * root causes precisely - many of these problems would be repairable
 * straight from a preflight report.
 *
 * This module is the batch front-end for that: scan every workspace,
 * classify it (passed / failed / never-verified / unparseable), and run
 * the preflight on the non-passing ones to produce an actionable repair
 * ticket per problem. The console renders the list; the user picks what
 * to fix; the existing per-problem verify button re-runs the pipeline
 * after a fix.
 */

export type RecycleStatus =
  | "passed"
  | "failed"
  | "unverified"
  | "unparseable";

export type RecycleEntry = {
  problemId: string;
  status: RecycleStatus;
  /** First failure message from the last verification, when there is one. */
  lastError: string | null;
  /** When the last verification ran, null when never. */
  lastVerifiedAt: string | null;
  /** Preflight diagnostics (the repair ticket), for non-passed problems. */
  preflight: string[];
  /** True when the preflight found something actionable. */
  hasTicket: boolean;
};

export type RecycleReport = {
  /** Every non-passed problem, most actionable first. */
  entries: RecycleEntry[];
  /** Counts by status for the header. */
  counts: { passed: number; failed: number; unverified: number; unparseable: number };
};

/** Read a workspace's verification verdict, null when never verified. */
async function readVerification(
  problemId: string,
): Promise<{ passed: boolean; ranAt: string | null; firstError: string | null } | null> {
  try {
    const raw = await fs.readFile(
      path.join(problemsDir, problemId, "meta.json"),
      "utf8",
    );
    const meta = JSON.parse(raw) as {
      verification?: { passed?: boolean; ranAt?: string; failures?: { message?: string }[] } | null;
    };
    if (!meta.verification) {
      return null;
    }
    return {
      passed: meta.verification.passed === true,
      ranAt: typeof meta.verification.ranAt === "string" ? meta.verification.ranAt : null,
      firstError: meta.verification.failures?.[0]?.message ?? null,
    };
  } catch {
    return null;
  }
}

/** Read a workspace's config, null when unparseable. */
async function readConfig(
  problemId: string,
): Promise<ProblemConfig | null> {
  try {
    const raw = await fs.readFile(
      path.join(problemsDir, problemId, "config.json"),
      "utf8",
    );
    return problemConfigSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Scan the registry and produce repair tickets for every non-passed problem.
 *
 * The preflight is the expensive part (it compiles the generator in the
 * sandbox), so it only runs for problems that are not passed. Passed
 * problems are counted but not probed.
 */
export async function recycleReport(): Promise<RecycleReport> {
  const groups = await listProblems();
  const counts = { passed: 0, failed: 0, unverified: 0, unparseable: 0 };
  const entries: RecycleEntry[] = [];

  for (const group of groups) {
    for (const entry of group.entries) {
      if (entry.error) {
        counts.unparseable += 1;
        entries.push({
          problemId: entry.problemId,
          status: "unparseable",
          lastError: entry.error,
          lastVerifiedAt: null,
          preflight: [
            "### config.json 无法解析",
            "```",
            entry.error,
            "```",
            "工作区不可用：题目库列不出它，验题脚本在读配置时就会失败。",
            "常见原因是模型回复被截断，写进去的 JSON 只写了一半。",
            "建议删除该工作区重新生成。",
          ],
          hasTicket: true,
        });
        continue;
      }
      if (!entry.summary) {
        counts.unparseable += 1;
        continue;
      }

      const verification = await readVerification(entry.problemId);
      if (verification?.passed) {
        counts.passed += 1;
        continue;
      }

      const status: RecycleStatus = verification ? "failed" : "unverified";
      counts[status] += 1;

      // The repair ticket: run the preflight suite on this workspace.
      const config = await readConfig(entry.problemId);
      let preflight: string[] = [];
      if (config) {
        preflight = await preflightCompile(entry.problemId, config).catch(() => []);
      }

      entries.push({
        problemId: entry.problemId,
        status,
        lastError: verification?.firstError ?? null,
        lastVerifiedAt: verification?.ranAt ?? null,
        preflight,
        hasTicket: preflight.length > 0,
      });
    }
  }

  // Most actionable first: problems with a preflight ticket, then failed,
  // then never-verified.
  const rank: Record<Exclude<RecycleStatus, "passed">, number> = {
    failed: 0,
    unverified: 1,
    unparseable: 2,
  };
  entries.sort((a, b) => {
    if (a.hasTicket !== b.hasTicket) return a.hasTicket ? -1 : 1;
    return rank[a.status as Exclude<RecycleStatus, "passed">] - rank[b.status as Exclude<RecycleStatus, "passed">];
  });

  return { entries, counts };
}
