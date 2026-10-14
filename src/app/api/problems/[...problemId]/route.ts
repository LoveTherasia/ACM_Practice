import { NextResponse } from "next/server";

import {
  deleteProblem,
  patchMeta,
  readProblem,
  readWorkspaceFile,
} from "@/lib/problems/store";
import { llmConfigured } from "@/lib/llm/provider";
import {
  verifyWorkspace,
  dropMissingSolutionEntries,
  checkSamplesAgainstSolutions,
} from "@/lib/problems/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * GET /api/problems/<category>/<dir>?file=docs/statement.md
 *
 * The problem id is two path segments (category + directory), captured by a
 * catch-all route. With `file`, returns that workspace file as text. Without
 * it, returns the config plus meta so the console can render the problem.
 *
 * POST /api/problems/<category>/<dir>
 *
 * Re-runs the local verifier on demand. A catch-all segment must be the last
 * part of the URL, so the verify action lives here as a POST rather than as
 * a /verify sub-route.
 *
 * POST /api/problems/<category>/<dir>/submit
 *
 * Judges a C++ submission. The catch-all swallows the trailing "submit"
 * segment, so this route dispatches on it instead of a sub-route.
 *
 * DELETE /api/problems/<category>/<dir>
 *
 * Removes the workspace and its category-index entry. Used to clean up
 * failed generations.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ problemId: string[] }> },
) {
  const { problemId: segments } = await params;
  const problemId = segments.join("/");
  let detail: Awaited<ReturnType<typeof readProblem>>;
  try {
    detail = await readProblem(problemId);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 422 },
    );
  }
  if (!detail) {
    return NextResponse.json({ error: `题目不存在: ${problemId}` }, { status: 404 });
  }

  const file = new URL(request.url).searchParams.get("file");
  if (file) {
    const content = await readWorkspaceFile(problemId, file);
    if (content === null) {
      return NextResponse.json(
        { error: `文件不存在: ${file}` },
        { status: 404 },
      );
    }
    return new NextResponse(content, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.json(detail);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ problemId: string[] }> },
) {
  const { problemId: segments } = await params;

  // Dispatch on a trailing action segment: the catch-all captures it, and
  // a sub-route would never win the match against the greedy parent.
  const action = segments[segments.length - 1];
  const idSegments =
    action === "submit" || action === "recheck" || action === "export-hydro"
      ? segments.slice(0, -1)
      : segments;
  if (idSegments.length !== 2) {
    return NextResponse.json(
      { error: `题目 id 应为 <分类>/<目录> 两级: ${segments.join("/")}` },
      { status: 400 },
    );
  }
  const problemId = idSegments.join("/");

  if (action === "submit") {
    return handleSubmit(request, problemId);
  }

  if (action === "recheck") {
    return handleRecheck(problemId);
  }
  if (action === "export-hydro") {
    const { handleHydroExport } = await import("./export-hydro");
    return handleHydroExport(request, problemId);
  }

  try {
    // On-demand verification is also the repair path for workspaces produced
    // by older pipeline versions, which can carry config entries pointing at
    // source files that were never written. The verifier throws on the first
    // such entry while parsing the config, so without this reconcile the
    // button would fail identically on every click, forever.
    await dropMissingSolutionEntries(problemId);

    // Re-verification must apply the same sample discipline as generation,
    // otherwise a hand-fixed statement can never be confirmed. Reported
    // alongside the verifier's own verdict because it is invisible to the
    // verifier, which never opens the statement.
    const sampleProblems = await checkSamplesAgainstSolutions(problemId).catch(
      () => [],
    );

    const verification = await verifyWorkspace(problemId);
    await patchMeta(problemId, { verification });
    return NextResponse.json({ verification, sampleProblems });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

/**
 * POST /api/problems/<category>/<dir>/recheck
 *
 * Ask the model to review the problem's artefacts for semantic errors that
 * local verification cannot catch - a checker that accepts anything, a
 * validator whose bounds disagree with the statement, a tutorial describing a
 * different algorithm than the code implements.
 *
 * Report-only: nothing is written to the workspace. The caller decides whether
 * to act on the findings, because editing a working problem on the strength of
 * one model opinion is how a working problem gets broken.
 */
async function handleRecheck(problemId: string) {
  if (!llmConfigured()) {
    return NextResponse.json(
      {
        error:
          "尚未配置模型凭据，无法做 AI 复核。请到「模型配置」填写 API key。",
      },
      { status: 503 },
    );
  }

  try {
    const { recheckProblem } = await import("@/lib/problems/recheck");
    const report = await recheckProblem(problemId);
    return NextResponse.json({ report });
  } catch (error) {
    return NextResponse.json(
      { error: `复核失败：${(error as Error).message}` },
      { status: 500 },
    );
  }
}

async function handleSubmit(request: Request, problemId: string) {
  const { z } = await import("zod");
  const { judgeSubmission } = await import("@/lib/problems/judge");

  const schema = z.object({
    language: z.literal("cpp"),
    source: z.string().min(1, "代码不能为空").max(200_000),
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  }

  try {
    const result = await judgeSubmission(problemId, parsed.data.source);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ problemId: string[] }> },
) {
  const { problemId: segments } = await params;
  if (segments.length !== 2) {
    return NextResponse.json(
      { error: `题目 id 应为 <分类>/<目录> 两级: ${segments.join("/")}` },
      { status: 400 },
    );
  }
  const problemId = segments.join("/");

  try {
    await deleteProblem(problemId);
    return NextResponse.json({ deleted: problemId });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
