"use client";

import { Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Delete button for a problem row.
 *
 * Failed generations are worth removing, but deletion is destructive and
 * unrecoverable, so it asks for confirmation first (taste-skill 4.5:
 * destructive actions confirm). On success the router refreshes the
 * server-rendered registry.
 */
export function DeleteProblemButton({
  problemId,
  title,
}: {
  problemId: string;
  title: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/problems/${problemId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? `删除失败 HTTP ${response.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className="rounded-md bg-fail px-2.5 py-1 text-[11px] font-medium text-on-accent disabled:opacity-50"
        >
          {deleting ? "删除中…" : "确认删除"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="rounded-md border border-line-strong px-2.5 py-1 text-[11px] text-muted"
        >
          取消
        </button>
      </span>
    );
  }

  return (
    <span className="relative inline-flex flex-col items-end">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title={`删除「${title}」（不可恢复）`}
        aria-label={`删除 ${title}`}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-subtle transition-colors duration-300 hover:bg-fail/15 hover:text-fail"
      >
        <Trash size={14} />
      </button>
      {error ? (
        <span
          role="alert"
          className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border border-line bg-raised px-2 py-1 text-left text-[11px] text-fail shadow-card"
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}
