"use client";

import { SpinnerGap } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Verification } from "@/lib/problems/schema";

/**
 * Re-run the local verifier on demand.
 *
 * The only interactive island on the problem detail page (Section 3.A). The
 * run takes minutes, so the button carries its own loading state and the
 * router refreshes the server-rendered verdict when it finishes.
 */
export function VerifyButton({
  problemId,
  initial,
}: {
  problemId: string;
  initial: Verification | null;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/problems/${problemId}`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? `请求失败 HTTP ${response.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={verify}
        disabled={running}
        className="inline-flex items-center gap-2 rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors duration-300 hover:bg-inset disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? (
          <>
            <SpinnerGap size={16} className="animate-spin" />
            验题中…
          </>
        ) : initial ? (
          "重新验题"
        ) : (
          "本地验题"
        )}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
