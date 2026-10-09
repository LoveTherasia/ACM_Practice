"use client";

import { CheckCircle, ShieldCheck, SpinnerGap, Warning } from "@phosphor-icons/react";
import { useState } from "react";

import type { RecheckReport } from "@/lib/problems/recheck";

/**
 * AI review panel for a generated problem.
 *
 * Local verification answers "does it run". This answers "is it correct" - a
 * question no script can settle, which is why the result is presented as a
 * report to read rather than an action that edits the workspace.
 *
 * The on-demand run takes tens of seconds, so the panel owns its loading state
 * and renders the findings inline (taste-skill 4.5: full state cycles).
 */

const VERDICT_STYLE: Record<RecheckReport["verdict"], string> = {
  ok: "text-pass",
  "needs-work": "text-warn",
  broken: "text-fail",
};

const VERDICT_LABEL: Record<RecheckReport["verdict"], string> = {
  ok: "未发现实质问题",
  "needs-work": "需要改进",
  broken: "存在错误判题风险",
};

const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-fail/15 text-fail",
  medium: "bg-warn/15 text-warn",
  low: "bg-inset text-muted",
};

const SEVERITY_LABEL: Record<string, string> = {
  high: "严重",
  medium: "中等",
  low: "轻微",
};

export function RecheckPanel({ problemId }: { problemId: string }) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<RecheckReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recheck = async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/problems/${problemId}/recheck`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { report?: RecheckReport; error?: string }
        | null;
      if (!response.ok || !payload?.report) {
        setError(payload?.error ?? `请求失败 HTTP ${response.status}`);
        return;
      }
      setReport(payload.report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mt-8 rounded-lg border border-line bg-surface p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <ShieldCheck size={18} className="text-accent-text" />
            AI 复核
          </h2>
          <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-muted">
            本地验题只能确认「能编译、能造数据、标程能通过」。
            这里让模型通读题面、题解、validator、generator、checker 与全部标程，
            找那些脚本查不出来的语义问题：checker 是否真的在判题、
            validator 的界与题面是否一致、数据是否覆盖了题面边界、题解与代码是否一致。
            <span className="text-subtle">
              （只做审查并给出报告，不会自动改动工作区。）
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={recheck}
          disabled={running}
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors duration-300 hover:bg-inset disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? (
            <>
              <SpinnerGap size={16} className="animate-spin" />
              复核中…
            </>
          ) : report ? (
            "重新复核"
          ) : (
            "AI 复核本题"
          )}
        </button>
      </div>

      {running ? (
        <p className="mt-4 text-xs text-accent-text">
          模型正在通读全部产物，通常需要 20–60 秒，请稍候…
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-fail">
          {error}
        </p>
      ) : null}

      {report ? (
        <div className="mt-5">
          <p className={`text-sm font-medium ${VERDICT_STYLE[report.verdict]}`}>
            {VERDICT_LABEL[report.verdict]}
          </p>
          {report.summary ? (
            <p className="mt-2 max-w-[80ch] text-sm leading-relaxed text-muted">
              {report.summary}
            </p>
          ) : null}

          {report.findings.length === 0 ? (
            <p className="mt-4 flex items-center gap-2 rounded-md border border-line bg-inset px-3 py-2 text-sm text-pass">
              <CheckCircle size={16} weight="fill" className="shrink-0" />
              通读后没有发现实质性问题。
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {report.findings.map((finding, index) => (
                <li
                  key={`${finding.area}-${index}`}
                  className="rounded-md border border-line bg-raised px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        SEVERITY_STYLE[finding.severity] ?? SEVERITY_STYLE.low
                      }`}
                    >
                      {SEVERITY_LABEL[finding.severity] ?? finding.severity}
                    </span>
                    <span className="font-mono text-xs text-accent-text">
                      {finding.area}
                    </span>
                  </div>
                  <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-ink">
                    <Warning size={15} className="mt-0.5 shrink-0 text-warn" />
                    <span className="min-w-0">{finding.issue}</span>
                  </p>
                  {finding.suggestion ? (
                    <p className="mt-1.5 pl-6 text-xs leading-relaxed text-muted">
                      建议：{finding.suggestion}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
