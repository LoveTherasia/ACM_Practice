import type { Metadata } from "next";
import Link from "next/link";

import { listProblems } from "@/lib/problems/store";
import { DeleteProblemButton } from "./delete-problem-button";

/**
 * The problem registry, grouped by category.
 *
 * Server Component reading the filesystem registry directly (Section 3.A:
 * RSC by default). The empty state is composed rather than a stub, per
 * taste-skill Section 4.5.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "题目库",
};

const DIFFICULTY_CLASS: Record<string, string> = {
  简单: "text-pass",
  中档: "text-warn",
  困难: "text-fail",
};

function formatDate(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default async function ConsolePage() {
  const groups = await listProblems();
  const totalProblems = groups.reduce(
    (sum, group) =>
      sum + group.entries.filter((e) => e.summary !== null).length,
    0,
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold leading-tight tracking-normal text-ink">
            题目库
          </h1>
          <p className="mt-1 text-sm text-muted">
            {totalProblems > 0
              ? `共 ${groups.length} 个分类、${totalProblems} 道题，来自 problems/ 目录。`
              : "还没有题目。生成第一道题后，它会按分类出现在这里。"}
          </p>
        </div>
        <Link
          href="/console/generate"
          className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98]"
        >
          开始造题
        </Link>
      </div>

      {groups.length === 0 ? (
        <div className="mt-12 rounded-lg border border-dashed border-line-strong px-6 py-16 text-center">
          <p className="text-base font-medium text-ink">题目库是空的</p>
          <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-relaxed text-muted">
            造题时填写题型分类（如 dp、graph），同一分类下的题目会自动编号
            （dp-001、dp-002…）存放在该分类目录下。
          </p>
          <Link
            href="/console/generate"
            className="mt-6 inline-flex items-center rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-on-accent"
          >
            开始造题
          </Link>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {groups.map((group) => {
            const good = group.entries.filter((e) => e.summary !== null);
            const broken = group.entries.filter((e) => e.summary === null);
            return (
              <section key={group.category}>
                <div className="flex items-baseline gap-3">
                  <h2 className="font-mono text-sm font-semibold text-accent-text">
                    {group.category}
                  </h2>
                  {group.label ? (
                    <span className="text-sm text-muted">{group.label}</span>
                  ) : null}
                  <span className="text-xs text-subtle">
                    {good.length} 道题
                  </span>
                </div>

                <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
                  {good.map((entry) => {
                    const summary = entry.summary;
                    if (!summary) {
                      return null;
                    }
                    return (
                      <li
                        key={entry.problemId}
                        className="flex items-stretch transition-colors duration-300 hover:bg-inset"
                      >
                        <Link
                          href={`/console/problems/${entry.problemId}`}
                          className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4"
                        >
                          <span className="font-mono text-sm text-accent-text">
                            {summary.dir}
                          </span>
                          <span className="text-sm font-medium text-ink">
                            {summary.title}
                          </span>
                          <span
                            className={`text-xs font-medium ${DIFFICULTY_CLASS[summary.difficulty] ?? ""}`}
                          >
                            {summary.difficulty}
                          </span>
                          {summary.interactive ? (
                            <span className="rounded-full bg-inset px-2 py-0.5 text-[10px] text-muted">
                              交互
                            </span>
                          ) : null}
                          {summary.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-inset px-2 py-0.5 text-[10px] text-muted"
                            >
                              {tag}
                            </span>
                          ))}
                          <span className="ml-auto flex items-center gap-4 text-xs text-subtle">
                            <span>{summary.timeLimitMs} ms</span>
                            <span>{summary.memoryLimitMb} MB</span>
                            <span
                              className={
                                summary.solved ? "text-pass" : "text-subtle"
                              }
                            >
                              {summary.solved ? "✓ 已通过" : "未提交通过"}
                            </span>
                            <span>{formatDate(summary.updatedAt)}</span>
                          </span>
                        </Link>
                        <span className="flex items-center pr-4">
                          <DeleteProblemButton
                            problemId={entry.problemId}
                            title={summary.title}
                          />
                        </span>
                      </li>
                    );
                  })}

                  {broken.map((entry) => (
                    <li
                      key={entry.problemId}
                      className="flex flex-wrap items-baseline gap-x-4 px-5 py-4 opacity-70"
                    >
                      <span className="font-mono text-sm text-subtle">
                        {entry.problemId}
                      </span>
                      <span className="text-xs text-fail">
                        工作区无法解析：{entry.error}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
