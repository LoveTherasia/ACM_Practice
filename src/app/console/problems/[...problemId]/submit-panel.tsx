"use client";

import { CheckCircle, Play, SpinnerGap, XCircle } from "@phosphor-icons/react";
import { useState } from "react";

import type { JudgeResult } from "@/lib/problems/judge";

/**
 * Code submission panel.
 *
 * A plain textarea editor plus a judge button. The verdict table shows
 * per-case results with AC/WA/TLE/MLE/RE badges; a compile error shows
 * the compiler output inline (taste-skill 4.5: full state cycles).
 */

const VERDICT_STYLE: Record<string, string> = {
  AC: "bg-pass/15 text-pass",
  WA: "bg-fail/15 text-fail",
  TLE: "bg-warn/15 text-warn",
  MLE: "bg-warn/15 text-warn",
  RE: "bg-fail/15 text-fail",
};

const VERDICT_TEXT: Record<string, string> = {
  AC: "AC 通过",
  WA: "WA 答案错误",
  TLE: "TLE 超时",
  MLE: "MLE 超内存",
  RE: "RE 运行错误",
};

const TEMPLATE = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    // 你的代码

    return 0;
}
`;

export function SubmitPanel({ problemId }: { problemId: string }) {
  const [source, setSource] = useState(TEMPLATE);
  const [judging, setJudging] = useState(false);
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setJudging(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/problems/${problemId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "cpp", source }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? `请求失败 HTTP ${response.status}`);
        return;
      }
      setResult(payload as JudgeResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJudging(false);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold leading-snug tracking-normal text-ink">
        提交代码
      </h2>

      <div className="mt-3 rounded-lg border border-line bg-surface">
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          rows={16}
          className="w-full resize-y rounded-t-lg bg-sunken px-4 py-3 font-mono text-[13px] leading-6 text-ink focus-ring"
          placeholder="在这里写你的 C++ 代码"
          aria-label="提交的 C++ 代码"
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={submit}
            disabled={judging || source.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2 text-sm font-medium text-on-accent transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {judging ? (
              <>
                <SpinnerGap size={16} className="animate-spin" />
                评测中…
              </>
            ) : (
              <>
                <Play size={16} weight="fill" />
                提交评测
              </>
            )}
          </button>
          <span className="text-xs text-subtle">
            gnu++20 编译，逐测试点评测，显示 AC / WA / TLE / RE 结果
          </span>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-line bg-inset px-3 py-2 text-sm text-fail"
        >
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-lg border border-line bg-surface">
          {result.compileError ? (
            <div className="px-5 py-4">
              <p className="flex items-center gap-2 text-sm font-medium text-fail">
                <XCircle size={16} weight="fill" />
                编译错误（CE）
              </p>
              <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-sunken px-4 py-3 font-mono text-xs leading-5 text-muted">
                {result.compileError}
              </pre>
            </div>
          ) : (
            <div className="px-5 py-4">
              <p
                className={`flex items-center gap-2 text-sm font-medium ${
                  result.accepted ? "text-pass" : "text-fail"
                }`}
              >
                {result.accepted ? (
                  <>
                    <CheckCircle size={16} weight="fill" />
                    通过全部 {result.total} 个测试点
                  </>
                ) : (
                  <>
                    <XCircle size={16} weight="fill" />
                    {result.passed} / {result.total} 个测试点通过
                  </>
                )}
              </p>

              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {result.verdicts.map((verdict) => (
                  <li
                    key={verdict.case}
                    className="flex items-center justify-between gap-2 rounded-md border border-line bg-sunken px-3 py-1.5"
                  >
                    <span className="truncate font-mono text-xs text-muted">
                      {verdict.case}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${VERDICT_STYLE[verdict.verdict] ?? ""}`}
                    >
                      {VERDICT_TEXT[verdict.verdict] ?? verdict.verdict}
                    </span>
                  </li>
                ))}
              </ul>

              {result.verdicts.some((v) => v.detail) ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted">
                    失败详情
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {result.verdicts
                      .filter((v) => v.detail)
                      .map((v) => (
                        <li
                          key={v.case}
                          className="font-mono text-xs leading-5 text-muted"
                        >
                          [{v.case}] {v.detail}
                        </li>
                      ))}
                  </ul>
                </details>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
