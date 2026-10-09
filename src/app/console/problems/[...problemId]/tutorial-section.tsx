"use client";

import { CaretDown, Eye, EyeSlash } from "@phosphor-icons/react";
import { useState } from "react";

import { Markdown } from "@/components/markdown/markdown";

/**
 * Collapsible tutorial reveal.
 *
 * The problem set exists to be solved, so the tutorial is hidden by default
 * and requires an explicit reveal (taste-skill 4.5: deliberate interaction,
 * not accidental spoilers). Once revealed it stays open for the session.
 */
export function TutorialSection({ tutorial }: { tutorial: string | null }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold leading-snug tracking-normal text-ink">
          题解
        </h2>
        {tutorial ? (
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-expanded={revealed}
            className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-300 hover:bg-inset"
          >
            {revealed ? (
              <>
                <EyeSlash size={14} />
                隐藏题解
              </>
            ) : (
              <>
                <Eye size={14} />
                查看题解
              </>
            )}
          </button>
        ) : null}
      </div>

      <div className="mt-3 rounded-lg border border-line bg-surface">
        {!tutorial ? (
          <p className="px-5 py-4 text-sm text-muted">（题解文件缺失）</p>
        ) : revealed ? (
          <div className="max-h-[70vh] overflow-auto px-5 py-4">
            <Markdown>{tutorial}</Markdown>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="flex w-full flex-col items-center gap-2 px-5 py-10 text-center transition-colors duration-300 hover:bg-inset"
          >
            <CaretDown size={20} className="text-subtle" />
            <span className="text-sm text-muted">
              题解已隐藏——先自己试试，需要时点击查看
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
