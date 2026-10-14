"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { SpinnerGap, Wrench } from "@phosphor-icons/react";

/**
 * The failed-problem recycling panel.
 *
 * Scans the registry for problems whose verification failed or never ran,
 * and shows a preflight-based repair ticket for each. The ticket names the
 * root cause the same way the generation pipeline would, so a fix can be
 * applied by hand and confirmed with the existing per-problem verify
 * button.
 */

type RecycleEntry = {
  problemId: string;
  status: "failed" | "unverified" | "unparseable" | "infrastructure";
  lastError: string | null;
  lastVerifiedAt: string | null;
  preflight: string[];
  checks: {
    id: string;
    title: string;
    status: "passed" | "failed" | "skipped";
    problems: string[];
    reason?: string;
  }[];
  hasTicket: boolean;
};

type RecycleReport = {
  entries: RecycleEntry[];
  counts: {
    passed: number;
    failed: number;
    unverified: number;
    unparseable: number;
    infrastructure: number;
  };
};

const STATUS_LABEL: Record<RecycleEntry["status"], string> = {
  failed: "验题失败",
  unverified: "从未验题",
  unparseable: "无法解析",
  infrastructure: "沙箱不可用（结论未知）",
};

const STATUS_CLASS: Record<RecycleEntry["status"], string> = {
  failed: "text-fail",
  unverified: "text-warn",
  unparseable: "text-subtle",
  infrastructure: "text-subtle",
};

export default function RecyclePage() {
  const [report, setReport] = useState<RecycleReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/recycle");
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? `HTTP ${response.status}`);
      }
      setReport((await response.json()) as RecycleReport);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-ink">
            题目回收站
          </h1>
          <p className="mt-1 text-sm text-muted">
            {report
              ? `共 ${report.counts.passed} 道通过、${report.entries.length} 道待回收（${report.counts.failed} 失败 / ${report.counts.unverified} 未验 / ${report.counts.infrastructure} 沙箱不可用 / ${report.counts.unparseable} 不可解析）。带诊断的排前面。`
              : "扫描全部工作区，为失败题目生成修复工单。"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-inset disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <SpinnerGap size={14} className="animate-spin" /> : <Wrench size={14} />}
          {loading ? "扫描中…（预检需要编译，约数分钟）" : "重新扫描"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-6 rounded-md border border-fail/30 bg-fail/10 px-4 py-3 text-sm text-fail">
          {error}
        </p>
      ) : null}

      {loading && !report ? (
        <p className="mt-12 text-center text-sm text-subtle">
          正在扫描工作区并对失败题目运行预检（沙箱内编译 generator）…
        </p>
      ) : null}

      {report && report.entries.length === 0 ? (
        <div className="mt-12 rounded-lg border border-dashed border-line-strong px-6 py-16 text-center">
          <p className="text-base font-medium text-ink">没有待回收的题目</p>
          <p className="mt-2 text-sm text-muted">全部工作区都已通过验题。</p>
        </div>
      ) : null}

      {report && report.entries.length > 0 ? (
        <ul className="mt-8 space-y-4">
          {report.entries.map((entry) => (
            <li
              key={entry.problemId}
              className="rounded-lg border border-line bg-surface"
            >
              <button
                type="button"
                onClick={() => setOpen(open === entry.problemId ? null : entry.problemId)}
                className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 text-left hover:bg-inset"
              >
                <span className="font-mono text-sm text-accent-text">
                  {entry.problemId}
                </span>
                <span className={`text-xs font-medium ${STATUS_CLASS[entry.status]}`}>
                  {STATUS_LABEL[entry.status]}
                </span>
                {entry.status === "infrastructure" ? (
                  <span className="text-[10px] text-subtle">非题目问题（沙箱不可用）</span>
                ) : entry.hasTicket ? (
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent-text">
                    有修复工单（{entry.preflight.length} 项）
                  </span>
                ) : (
                  <span className="text-[10px] text-subtle">预检未发现问题（需人工排查）</span>
                )}
                {entry.checks.some((c) => c.status === "skipped") ? (
                  <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[10px] text-warn">
                    {entry.checks.filter((c) => c.status === "skipped").length} 项检查未执行
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-subtle">
                  {entry.lastVerifiedAt
                    ? `上次验题 ${new Date(entry.lastVerifiedAt).toLocaleString("zh-CN")}`
                    : "从未验题"}
                </span>
              </button>

              {entry.lastError ? (
                <p className="border-t border-line px-5 py-2 font-mono text-xs text-fail/90">
                  {entry.lastError}
                </p>
              ) : null}

              {open === entry.problemId ? (
                <div className="border-t border-line px-5 py-4">
                  {entry.checks.length > 0 ? (
                    <ul className="mb-4 grid gap-1 sm:grid-cols-2">
                      {entry.checks.map((check) => (
                        <li key={check.id} className="flex items-start gap-2 text-xs">
                          <span
                            className={`shrink-0 font-medium ${
                              check.status === "failed"
                                ? "text-fail"
                                : check.status === "skipped"
                                  ? "text-warn"
                                  : "text-pass"
                            }`}
                          >
                            {check.status === "failed"
                              ? "未通过"
                              : check.status === "skipped"
                                ? "未执行"
                                : "通过"}
                          </span>
                          <span className="text-ink">{check.title}</span>
                          {check.status === "skipped" && check.reason ? (
                            <span className="text-subtle">— {check.reason}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {entry.preflight.length > 0 ? (
                    <div className="space-y-4">
                      {entry.preflight.map((ticket, i) => (
                        <pre
                          key={i}
                          className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-inset px-4 py-3 font-mono text-xs leading-relaxed text-muted"
                        >
                          {ticket}
                        </pre>
                      ))}
                    </div>
                  ) : entry.status === "infrastructure" ? (
                    <p className="text-sm text-muted">
                      上次验题因<strong>沙箱不可用</strong>中断（Docker Desktop
                      未运行或已停止），本次结果不代表题目有问题——题目根本没有跑过。
                      启动 Docker Desktop 后，用题目详情页的「重新验题」即可，无需修改任何文件。
                    </p>
                  ) : (
                    <p className="text-sm text-muted">
                      预检（语言/格式/类型契约/样例同步/树检查/区分度）没有发现问题。
                      失败原因可能在运行时语义层面，建议用题目详情页的「重新验题」
                      获取完整日志，或用「AI 复核」做语义审查。
                    </p>
                  )}
                  <div className="mt-4 flex gap-3">
                    <Link
                      href={`/console/problems/${entry.problemId}`}
                      className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-xs font-medium text-on-accent"
                    >
                      打开题目（修复后重验）→
                    </Link>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
