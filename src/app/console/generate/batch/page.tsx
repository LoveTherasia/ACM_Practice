"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";

import { CaretDown, Lightning, SpinnerGap } from "@phosphor-icons/react";

import { CATEGORIES } from "@/lib/problems/categories";

/**
 * The batch generation page.
 *
 * Queue N problems with a concurrency cap; each gets its own AI-brainstormed
 * premise and runs the full pipeline. The dashboard shows per-item status,
 * the current pipeline stage, and a shared log tail.
 */

type BatchItem = {
  index: number;
  category: string;
  categoryLabel: string;
  difficulty: string;
  premise: string;
  title: string;
  status: "pending" | "ideating" | "generating" | "done" | "failed";
  problemId: string | null;
  runStatus: string | null;
  error: string | null;
};

type BatchEvent =
  | { type: "item"; item: BatchItem }
  | { type: "log"; index: number; role: string; message: string }
  | { type: "stage"; index: number; role: string; status: string }
  | { type: "done"; summary: { total: number; passed: number; failed: number } }
  | { type: "error"; message: string };

const DIFFICULTIES = ["简单", "中档", "困难"] as const;

const STATUS_LABEL: Record<BatchItem["status"], string> = {
  pending: "排队中",
  ideating: "构思 idea…",
  generating: "生成中",
  done: "完成",
  failed: "失败",
};

const STATUS_CLASS: Record<BatchItem["status"], string> = {
  pending: "text-subtle",
  ideating: "text-warn",
  generating: "text-accent-text",
  done: "text-pass",
  failed: "text-fail",
};

const STAGE_TITLES: Record<string, string> = {
  architect: "架构",
  "judge-validator": "judge",
  "solutions-tutorial": "标程",
  integrator: "审查",
  verifier: "验题",
};

export default function BatchPage() {
  const [count, setCount] = useState(3);
  const [concurrency, setConcurrency] = useState(2);
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>("中档");

  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [stages, setStages] = useState<Record<number, string>>({});
  const [logs, setLogs] = useState<{ index: number; text: string }[]>([]);
  const [summary, setSummary] = useState<{ total: number; passed: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);

  const appendLog = useCallback((index: number, text: string) => {
    setLogs((prev) => [...prev.slice(-200), { index, text }]);
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    });
  }, []);

  const start = async () => {
    setRunning(true);
    setConnected(false);
    setItems([]);
    setStages({});
    setLogs([]);
    setSummary(null);
    setError(null);

    try {
      const response = await fetch("/api/generate/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count, concurrency, category, difficulty }),
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? `请求失败 HTTP ${response.status}`);
        setRunning(false);
        return;
      }

      setConnected(true);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawTerminal = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as BatchEvent;
            if (event.type === "done" || event.type === "error") {
              sawTerminal = true;
            }
            if (event.type === "item") {
              setItems((prev) => {
                const next = [...prev];
                next[event.item.index] = event.item;
                return next;
              });
            } else if (event.type === "stage") {
              setStages((prev) => ({
                ...prev,
                [event.index]: `${STAGE_TITLES[event.role] ?? event.role}:${event.status}`,
              }));
            } else if (event.type === "log") {
              appendLog(event.index, `[${event.role}] ${event.message}`);
            } else if (event.type === "done") {
              setSummary(event.summary);
            } else if (event.type === "error") {
              setError(event.message);
            }
          } catch {
            // Malformed frame; ignore.
          }
        }
      }

      if (!sawTerminal) {
        setError("批量流在结束前断开。已完成的题目会保留在题目库。");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      setConnected(false);
    }
  };

  const selectedCategory = CATEGORIES.find((c) => c.id === category) ?? null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-16 pt-8 sm:px-6 lg:px-8 lg:pt-12">
      <header className="border-b border-line pb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-text">
          Problem studio / batch
        </p>
        <h1 className="mt-3 text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-ink">
          批量造题
        </h1>
        <p className="mt-3 max-w-[52ch] text-sm leading-7 text-muted">
          排队生成一批题目：每道先由 AI 构思 idea，再走完整流水线（含沙箱验题）。
          适合夜间挂机积累训练数据。
        </p>
      </header>

      <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        {/* ---------------- Config ---------------- */}
        <section className="min-w-0 rounded-2xl border border-line bg-raised p-6 shadow-card md:p-8">
          <div className="flex flex-col gap-2">
            <label htmlFor="batch-count" className="text-sm font-medium text-ink">
              生成数量
            </label>
            <input
              id="batch-count"
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              disabled={running}
              className="rounded-md border border-line-strong bg-raised px-3 py-2 text-sm text-ink focus-ring"
            />
            <p className="text-xs text-subtle">1–20 道，每道约 10–60 分钟。</p>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <label htmlFor="batch-concurrency" className="text-sm font-medium text-ink">
              并发数
            </label>
            <input
              id="batch-concurrency"
              type="number"
              min={1}
              max={4}
              value={concurrency}
              onChange={(e) => setConcurrency(Math.max(1, Math.min(4, Number(e.target.value) || 1)))}
              disabled={running}
              className="rounded-md border border-line-strong bg-raised px-3 py-2 text-sm text-ink focus-ring"
            />
            <p className="text-xs text-subtle">
              同时跑几道（1–4）。API 限流时降到 1；本地机器强可到 4。
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <label htmlFor="batch-category" className="text-sm font-medium text-ink">
              题型分类
            </label>
            <div className="relative">
              <select
                id="batch-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={running}
                className="w-full appearance-none rounded-md border border-line-strong bg-raised px-3 py-2 pr-9 text-sm text-ink focus-ring"
              >
                <option value="">每题随机（推荐）</option>
                {CATEGORIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}（{item.id}）
                  </option>
                ))}
              </select>
              <CaretDown size={14} aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-subtle" />
            </div>
            {selectedCategory ? (
              <p className="text-xs text-subtle">{selectedCategory.hint}</p>
            ) : (
              <p className="text-xs text-subtle">
                每道题从 {CATEGORIES.length} 个题型中独立随机，保证分布均匀。
              </p>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">难度</span>
            <div className="flex gap-2">
              {DIFFICULTIES.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setDifficulty(level)}
                  disabled={running}
                  aria-pressed={difficulty === level}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors duration-300 ${
                    difficulty === level
                      ? "bg-accent text-on-accent"
                      : "border border-line-strong text-ink hover:bg-inset"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={start}
            disabled={running}
            className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-medium text-on-accent shadow-card transition-[background-color,transform] duration-200 hover:-translate-y-px hover:bg-accent/90 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? (
              <>
                <SpinnerGap size={16} className="animate-spin" />
                {connected ? "批量生成中…" : "正在启动…"}
              </>
            ) : (
              <>
                <Lightning size={16} />
                开始批量生成
              </>
            )}
          </button>

          {error ? (
            <p role="alert" className="mt-4 rounded-md border border-fail/30 bg-fail/10 px-3 py-2 text-sm text-fail">
              {error}
            </p>
          ) : null}

          {summary ? (
            <div className="mt-4 rounded-md border border-line bg-inset px-3 py-3 text-sm">
              <p className="font-medium text-ink">
                批量完成：{summary.passed} 通过 / {summary.failed} 失败 / 共 {summary.total}
              </p>
              <Link href="/console" className="mt-1 inline-block text-xs text-accent-text underline underline-offset-2">
                到题目库查看 →
              </Link>
            </div>
          ) : null}
        </section>

        {/* ---------------- Dashboard ---------------- */}
        <section className="flex min-h-[420px] min-w-0 flex-col rounded-lg border border-line bg-sunken shadow-panel">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold text-ink">批量进度</h2>
          </div>

          {items.length === 0 ? (
            <p className="px-5 py-8 text-sm text-subtle">
              {running ? "正在排队…" : "配置左侧参数后点击「开始批量生成」。"}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.index} className="px-5 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-subtle">#{item.index + 1}</span>
                    <span className="font-mono text-xs text-accent-text">{item.category}</span>
                    <span className={`text-xs font-medium ${STATUS_CLASS[item.status]}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                    {stages[item.index] ? (
                      <span className="rounded-full bg-inset px-2 py-0.5 text-[10px] text-muted">
                        {stages[item.index]}
                      </span>
                    ) : null}
                    {item.title ? (
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">{item.title}</span>
                    ) : null}
                    {item.problemId && item.status === "done" ? (
                      <Link
                        href={`/console/problems/${item.problemId}`}
                        className="text-[10px] text-accent-text underline underline-offset-2"
                      >
                        {item.problemId} →
                      </Link>
                    ) : null}
                    {item.error ? (
                      <span className="w-full truncate text-[10px] text-fail">{item.error}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div
            ref={logRef}
            className="mt-auto max-h-64 flex-1 overflow-y-auto border-t border-line px-5 py-3"
          >
            {logs.length === 0 ? (
              <p className="font-mono text-xs text-subtle">
                {running ? "等待第一个事件…" : "日志将在这里实时滚动。"}
              </p>
            ) : (
              logs.map((line, i) => (
                <p key={i} className="font-mono text-xs leading-5 text-muted">
                  <span className="text-accent-text">[#{line.index + 1}]</span> {line.text}
                </p>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
