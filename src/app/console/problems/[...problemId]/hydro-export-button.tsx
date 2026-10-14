"use client";

import { Archive, SpinnerGap } from "@phosphor-icons/react";
import { useState } from "react";

/**
 * Export the workspace as a Hydro OJ zip.
 *
 * The export runs inside the sandbox (the script needs powershell-yaml and
 * reads the whole workspace), and the zip streams back as a download. The
 * button is disabled until the problem has passed verification: exporting
 * an unverified problem ships data nobody has vouched for.
 */
export function HydroExportButton({
  problemId,
  verified,
}: {
  problemId: string;
  verified: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportZip = async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/problems/${problemId}/export-hydro`,
        { method: "POST" },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? `请求失败 HTTP ${response.status}`);
        return;
      }
      // Stream the zip to a download.
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${problemId.split("/")[1] ?? "problem"}.hydro.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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
        onClick={exportZip}
        disabled={running || !verified}
        title={
          verified
            ? "打包为 Hydro OJ 题目 zip（沙箱内执行）"
            : "只有验题通过的题目才能导出"
        }
        className="inline-flex items-center gap-2 rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors duration-300 hover:bg-inset disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? (
          <>
            <SpinnerGap size={16} className="animate-spin" />
            导出中…
          </>
        ) : (
          <>
            <Archive size={16} />
            导出 Hydro 题包
          </>
        )}
      </button>
      {error ? (
        <p role="alert" className="max-w-[60ch] text-right text-xs text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
