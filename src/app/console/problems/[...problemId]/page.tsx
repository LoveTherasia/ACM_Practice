import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { readProblem, readWorkspaceFile } from "@/lib/problems/store";
import { Markdown } from "@/components/markdown/markdown";
import { RecheckPanel } from "./recheck-panel";
import { SubmitPanel } from "./submit-panel";
import { TutorialSection } from "./tutorial-section";
import { VerifyButton } from "./verify-button";
import { HydroExportButton } from "./hydro-export-button";

/**
 * The problem detail page.
 *
 * Server Component: config, meta, statement and tutorial are read from the
 * workspace on request. The verify button is the only interactive island.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ problemId: string[] }>;
}): Promise<Metadata> {
  const { problemId: segments } = await params;
  const problemId = segments.join("/");
  // readProblem throws on a workspace whose config.json fails validation. That
  // is a recoverable state the page body renders as an error card, so metadata
  // must degrade quietly: an uncaught throw here would make Next log a server
  // error with a digest even though the route itself answers 200.
  try {
    const detail = await readProblem(problemId);
    return {
      title: detail ? detail.meta.title : problemId,
      ...(detail ? {} : { description: "题目工作区不存在或尚未生成。" }),
    };
  } catch {
    return { title: `${problemId} · 工作区无法解析` };
  }
}

export default async function ProblemPage({
  params,
}: {
  params: Promise<{ problemId: string[] }>;
}) {
  const { problemId: segments } = await params;
  const problemId = segments.join("/");
  let detail: Awaited<ReturnType<typeof readProblem>>;
  try {
    detail = await readProblem(problemId);
  } catch (error) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-8">
        <Link
          href="/console"
          className="text-sm text-muted transition-colors duration-300 hover:text-ink"
        >
          ← 题目库
        </Link>
        <div className="mt-6 rounded-lg border border-line bg-surface px-6 py-8">
          <h1 className="font-mono text-lg text-fail">{problemId}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {(error as Error).message}
          </p>
        </div>
      </div>
    );
  }
  if (!detail) {
    notFound();
  }

  const { config, meta, summary } = detail;
  const statement = await readWorkspaceFile(problemId, config.statement);
  const tutorial = await readWorkspaceFile(problemId, config.tutorial);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href="/console"
        className="text-sm text-muted transition-colors duration-300 hover:text-ink"
      >
        ← 题目库
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-accent-text">{problemId}</p>
          <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-normal text-ink">
            {meta.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{meta.difficulty}</span>
            {config.interactive ? <span>· 交互题</span> : null}
            <span>
              · {config.timeLimitMs} ms / {config.memoryLimitMb} MB
            </span>
            {meta.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-inset px-2 py-0.5 text-[10px]"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <VerifyButton problemId={problemId} initial={meta.verification} />
          <HydroExportButton
            problemId={problemId}
            verified={meta.verification?.passed === true}
          />
        </div>
      </div>

      {/* Verification verdict */}
      {meta.verification ? (
        <div
          className={`mt-6 rounded-lg border px-5 py-4 text-sm ${
            meta.verification.passed
              ? "border-line bg-surface text-pass"
              : meta.verification.infrastructure
                ? "border-line bg-surface text-warn"
                : "border-line bg-surface text-fail"
          }`}
        >
          <p className="font-medium">
            {meta.verification.passed
              ? `验题通过 · ${meta.verification.passedCases} 个测试点`
              : meta.verification.infrastructure
                ? "未获得验题结论 · 沙箱不可用（Docker Desktop 未运行或已停止）"
                : `验题未通过 · ${meta.verification.failures.length} 项失败`}
          </p>
          {meta.verification.failures.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {meta.verification.failures.slice(0, 5).map((failure, index) => (
                <li
                  key={index}
                  className="font-mono text-xs leading-5 text-muted"
                >
                  [{failure.scope}] {failure.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Workspace overview */}
      <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["测试点", `${summary.caseCount} 个`],
          ["标程", `${summary.solutionCount} 份`],
          ["错解", `${summary.wrongSolutionCount} 个`],
          [
            "judge",
            config.interactive
              ? `interactor (${config.interactor})`
              : `checker (${config.checker})`,
          ],
        ].map(([label, value]) => (
          <div key={label} className="bg-surface px-5 py-4">
            <p className="text-xs text-subtle">{label}</p>
            <p className="mt-1 text-sm font-medium text-ink">{value}</p>
          </div>
        ))}
      </div>

      {/* Statement - the primary surface for solving the problem */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold leading-snug tracking-normal text-ink">
          题面
        </h2>
        <div className="mt-3 rounded-lg border border-line bg-surface px-5 py-4">
          {statement ? (
            <Markdown>{statement}</Markdown>
          ) : (
            <p className="text-sm text-muted">（题面文件缺失）</p>
          )}
        </div>
      </section>

      {/* Submission - solve it here */}
      <SubmitPanel problemId={problemId} />

      {/* Tutorial - hidden until explicitly revealed */}
      <div className="mt-10">
        <TutorialSection tutorial={tutorial} />
      </div>

      {/* AI review - the semantic check local verification cannot do */}
      <RecheckPanel problemId={problemId} />
    </div>
  );
}
