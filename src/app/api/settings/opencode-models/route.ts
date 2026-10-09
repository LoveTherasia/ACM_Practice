import { execFile } from "node:child_process";
import { NextResponse } from "next/server";

import { opencodeCli, opencodeModel } from "@/lib/llm/opencode";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/opencode-models
 *
 * The models this machine can actually reach through OpenCode.
 *
 * OpenCode holds the provider logins, so only it knows which are valid; a
 * hard-coded list in the UI would offer models that fail on the first call. The
 * CLI takes a few seconds, which is why this is its own route instead of part
 * of the settings GET.
 *
 * The CLI is resolved through the same helper the generation path uses, so the
 * auto-detection of the OpenCode Desktop bundle applies here too - otherwise
 * this endpoint would report "not found" on a machine where generation works.
 */
export async function GET() {
  let cli: string;
  try {
    cli = await opencodeCli();
  } catch (error) {
    return NextResponse.json({
      ok: false,
      models: [],
      current: opencodeModel(),
      error: (error as Error).message,
    });
  }

  const result = await new Promise<{
    ok: boolean;
    models: string[];
    error?: string;
  }>((resolve) => {
    execFile(
      cli,
      ["models"],
      { timeout: 90_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const models = String(stdout)
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.includes("/"));

        // `opencode models` can exit non-zero and still print a usable list, so
        // an error is only reported when there is nothing to show.
        if (error && models.length === 0) {
          resolve({
            ok: false,
            models: [],
            error:
              `无法运行 \`${cli} models\`：${(error as Error).message}。` +
              (String(stderr).trim()
                ? ` stderr: ${String(stderr).trim().slice(0, 200)}`
                : " 如果列表为空，请先在 OpenCode 中登录一个 provider（opencode auth login）。"),
          });
          return;
        }
        resolve({ ok: true, models });
      },
    );
  });

  return NextResponse.json({ ...result, cli, current: opencodeModel() });
}
