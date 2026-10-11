"use client";

import { CaretDown, Sparkle, SpinnerGap } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { CATEGORIES } from "@/lib/problems/categories";
import { STAGES } from "@/lib/pipeline/stages";
import type { PipelineEvent, } from "@/lib/llm/orchestrate";
import type {
  PipelineRun,
  PipelineStage,
  StageStatus,
} from "@/lib/problems/schema";

/**
 * The generate page.
 *
 * Client Component by necessity: it holds form state and consumes a
 * long-lived SSE stream (Section 3.A interactivity isolation). The stage list
 * itself is imported from the pipeline module so the landing page and this
 * page describe the same pipeline from one source.
 */

type LogLine = {
  role: string;
  message: string;
};

const STATUS_DOT: Record<StageStatus, string> = {
  pending: "bg-line-strong",
  running: "bg-accent animate-pulse",
  done: "bg-pass",
  failed: "bg-fail",
  skipped: "bg-line-strong",
};

const DIFFICULTIES = ["简单", "中档", "困难"] as const;

export default function GeneratePage() {
  const [category, setCategory] = useState("");
  const [premise, setPremise] = useState("");
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>(
    "中档",
  );
  const [interactive, setInteractive] = useState(false);
  const [tags, setTags] = useState("");

  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finishedRun, setFinishedRun] = useState<PipelineRun | null>(null);

  /** Brainstorm loading state (taste-skill 4.5: full interactive cycles). */
  const [ideating, setIdeating] = useState(false);
  const [ideaNotice, setIdeaNotice] = useState<string | null>(null);

  /** Pipeline error, mirrored into the progress panel so it is visible
   *  even when the form column is scrolled out of view. */
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);

  // The select only ever offers "" (random) or a built-in category id, so
  // there is no free-text value left to validate here. The API still does its
  // own validation, because a request can arrive without going through the UI.
  const premiseValid = premise.trim().length >= 8;
  const canSubmit = premiseValid && !running;

  /** The chosen category definition, null when "random" is selected. */
  const selectedCategory =
    CATEGORIES.find((item) => item.id === category) ?? null;

  const appendLog = useCallback((role: string, message: string) => {
    setLogs((prev) => [...prev, { role, message }]);
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({
        top: logRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, []);

  const handleEvent = useCallback(
    (event: PipelineEvent) => {
      if (event.type === "stage") {
        setStages(event.run.stages);
      } else if (event.type === "log") {
        appendLog(event.role, event.message);
      } else if (event.type === "done") {
        setFinishedRun(event.run);
        setRunning(false);
      } else if (event.type === "error") {
        setError(event.message);
        setPipelineError(event.message);
        setRunning(false);
      }
    },
    [appendLog],
  );

  const submit = async () => {
    setRunning(true);
    setConnected(false);
    setStages([]);
    setLogs([]);
    setError(null);
    setPipelineError(null);
    setFinishedRun(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: category.trim(),
          premise: premise.trim(),
          difficulty,
          interactive,
          tags: tags
            .split(/[,，、\s]+/)
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 8),
        }),
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
      /**
       * Whether the server told us how the run ended.
       *
       * The stream can close without a `done` or `error` frame - the server
       * process dies, the connection is dropped, or the run was aborted - and
       * the loop below then just ends. Without this flag the page kept its
       * "running" state forever and showed only the last event it managed to
       * receive (typically "已创建工作区"), which reads as if the run were
       * still in progress. The problem workspace could meanwhile be complete or
       * half-written on disk, with nothing in the UI to say so.
       */
      let sawTerminalEvent = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) {
            continue;
          }
          try {
            const event = JSON.parse(line.slice(6)) as PipelineEvent;
            if (event.type === "done" || event.type === "error") {
              sawTerminalEvent = true;
            }
            handleEvent(event);
          } catch {
            // A malformed frame must not kill the stream.
          }
        }
      }

      if (!sawTerminalEvent) {
        setError(
          "进度流在结束前就断开了，没有收到完成或失败事件。这通常意味着服务端在造题过程中被重启或中断。" +
            "题目工作区可能只写了一半，请到题目库确认它的实际状态，必要时删掉重新生成。",
        );
        setRunning(false);
        setConnected(false);
      }
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
      setConnected(false);
    }
  };

  const brainstorm = async () => {
    setIdeating(true);
    setIdeaNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/idea", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: tags.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? `请求失败 HTTP ${response.status}`);
        return;
      }
      const idea = (await response.json()) as {
        title: string;
        premise: string;
        tags: string[];
      };
      setPremise(idea.premise);
      // Tags stay untouched: the user's own direction (if any) is the input,
      // and the idea's suggested tags are shown in the notice instead of
      // overwriting what the user typed.
      setIdeaNotice(
        `已生成 idea「${idea.title}」，已填入下方，可自行修改。` +
          (idea.tags.length > 0 ? `建议方向：${idea.tags.join("、")}` : ""),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIdeating(false);
    }
  };

  const stageByRole = new Map(stages.map((s) => [s.role, s]));

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold leading-tight tracking-normal text-ink">
        造题
      </h1>
      <p className="mt-1 text-sm text-muted">
        给出一个 idea，流水线会生成完整题目工作区并跑通本地验题。整个过程可能需要几分钟。
      </p>

      <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        {/* ---------------- Form ---------------- */}
        <section className="min-w-0 rounded-lg border border-line bg-surface p-6 shadow-card">
          <div className="flex flex-col gap-2">
            <label htmlFor="category" className="text-sm font-medium text-ink">
              题型分类
            </label>
            <div className="relative">
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={running}
                className="w-full appearance-none rounded-md border border-line-strong bg-raised px-3 py-2 pr-9 text-sm text-ink focus-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">随机（推荐）</option>
                {CATEGORIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}（{item.id}）
                  </option>
                ))}
              </select>
              <CaretDown
                size={14}
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-subtle"
              />
            </div>
            <p className="text-xs text-subtle">
              {selectedCategory
                ? `同一分类下的题目自动编号（${selectedCategory.id}-001、${selectedCategory.id}-002…）。${selectedCategory.hint}`
                : `从 ${CATEGORIES.length} 个内置题型中随机选一个（${CATEGORIES.map((item) => item.label).join("、")}），并围绕该方向出题。`}
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <label htmlFor="premise" className="text-sm font-medium text-ink">
              核心 idea
            </label>
            <textarea
              id="premise"
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              placeholder="题目想考什么机制？预期的卡点是什么？"
              rows={6}
              disabled={running}
              className="resize-y rounded-md border border-line-strong bg-raised px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-subtle focus-ring"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-xs text-subtle">
                {premiseValid
                  ? "至少 8 个字符。"
                  : "请写清楚题目想考什么机制（至少 8 个字符）。"}
              </p>
              <button
                type="button"
                onClick={brainstorm}
                disabled={running || ideating}
                aria-busy={ideating}
                className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-300 hover:bg-inset disabled:cursor-not-allowed disabled:opacity-60"
              >
                {ideating ? (
                  <>
                    <SpinnerGap size={14} className="animate-spin" />
                    正在构思…
                  </>
                ) : (
                  <>
                    <Sparkle size={14} />
                    让 AI 出个 idea
                  </>
                )}
              </button>
            </div>
            {ideating ? (
              <p className="text-xs text-accent-text">
                模型正在构思题目 idea，通常需要 10–30 秒，请稍候…
              </p>
            ) : null}
            {ideaNotice && !ideating ? (
              <p
                role="status"
                className="rounded-md border border-line bg-inset px-3 py-2 text-xs text-pass"
              >
                {ideaNotice}
              </p>
            ) : null}
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

          <div className="mt-6 flex flex-col gap-2">
            <label htmlFor="tags" className="text-sm font-medium text-ink">
              方向标签（可选）
            </label>
            <input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="图论, 构造"
              disabled={running}
              className="rounded-md border border-line-strong bg-raised px-3 py-2 text-sm text-ink placeholder:text-subtle focus-ring"
            />
          </div>

          <div className="mt-6 flex items-center gap-3">
            <input
              id="interactive"
              type="checkbox"
              checked={interactive}
              onChange={(e) => setInteractive(e.target.checked)}
              disabled={running}
              className="h-4 w-4 rounded border-line-strong accent-[var(--accent)]"
            />
            <label htmlFor="interactive" className="text-sm text-ink">
              交互题（生成 interactor 而不是 checker）
            </label>
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-on-accent transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? (
              <>
                <SpinnerGap size={16} className="animate-spin" />
                {connected ? "生成中…" : "正在启动流水线…"}
              </>
            ) : (
              "开始生成"
            )}
          </button>

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-md border border-line bg-inset px-3 py-2 text-sm text-fail"
            >
              {error}
            </p>
          ) : null}

          {finishedRun && finishedRun.status === "done" ? (
            <div className="mt-4 rounded-md border border-line bg-inset px-3 py-3 text-sm">
              <p className="font-medium text-pass">生成完成，验题通过。</p>
              <Link
                href={`/console/problems/${finishedRun.slug}`}
                className="mt-1 inline-block text-accent-text underline underline-offset-2"
              >
                查看 {finishedRun.slug} →
              </Link>
            </div>
          ) : null}

          {finishedRun && finishedRun.status === "failed" ? (
            <p className="mt-4 rounded-md border border-line bg-inset px-3 py-2 text-sm text-fail">
              流水线部分阶段失败。可以查看下方日志定位问题，工作区文件已保留在
              problems/{finishedRun.slug}。
            </p>
          ) : null}
        </section>

        {/* ---------------- Live progress ---------------- */}
        <section className="flex min-h-[420px] min-w-0 flex-col rounded-lg border border-line bg-sunken shadow-panel">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold text-ink">流水线进度</h2>
          </div>

          {pipelineError ? (
            <div
              role="alert"
              className="border-b border-line bg-fail/10 px-5 py-3"
            >
              <p className="text-sm font-medium text-fail">
                流水线已中止
              </p>
              <p className="mt-1 break-words text-xs leading-relaxed text-fail/90">
                {pipelineError}
              </p>
            </div>
          ) : null}

          <ol className="divide-y divide-line">
            {STAGES.map((stage) => {
              const live = stageByRole.get(stage.role);
              const status: StageStatus = live?.status ?? "pending";
              const failed = status === "failed";
              return (
                <li
                  key={stage.role}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 ${
                    failed ? "bg-fail/10" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`}
                  />
                  <span
                    className={`min-w-0 text-sm font-medium ${
                      failed ? "text-fail" : "text-ink"
                    }`}
                  >
                    {stage.title}
                  </span>
                  <span
                    className={`w-full truncate text-xs sm:ml-auto sm:w-auto sm:max-w-[55%] ${
                      failed ? "text-fail/90" : "text-subtle"
                    }`}
                  >
                    {live?.error
                      ? live.error
                      : (live?.summary || stage.summary)}
                  </span>
                </li>
              );
            })}
          </ol>

          <div
            ref={logRef}
            className="mt-auto max-h-64 flex-1 overflow-y-auto border-t border-line px-5 py-3"
          >
            {logs.length === 0 ? (
              <p className="font-mono text-xs text-subtle">
                {running
                  ? connected
                    ? "已连接流水线，等待第一个事件…"
                    : "正在建立连接…"
                  : "等待启动…"}
              </p>
            ) : (
              logs.map((line, index) => (
                <p key={index} className="font-mono text-xs leading-5 text-muted">
                  <span className="text-accent-text">[{line.role}]</span>{" "}
                  {line.message}
                </p>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
