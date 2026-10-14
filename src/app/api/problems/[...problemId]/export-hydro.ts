import { NextResponse } from "next/server";
import path from "node:path";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * POST /api/problems/<category>/<dir>/export-hydro
 *
 * Packages the workspace into a Hydro OJ zip inside the sandbox and
 * streams the zip back as a download. The catch-all problem route
 * dispatches on the trailing "export-hydro" segment.
 */
export async function handleHydroExport(
  _request: Request,
  problemId: string,
) {
  try {
    const { exportHydroZip } = await import("@/lib/problems/hydro-export");
    // The zip lands in a temp dir; it is read and deleted within this
    // request so no artefacts accumulate on the host.
    const os = await import("node:os");
    const outDir = path.join(os.tmpdir(), `hydro-export-${Date.now()}`);
    const result = await exportHydroZip(problemId, outDir);
    if (!result.ok || !result.zipPath) {
      return NextResponse.json(
        {
          error:
            "Hydro 导出失败。常见原因：工作区缺少验题数据（先重新验题生成 testdata），" +
            "或导出脚本对当前 config 不满足前提。脚本日志尾部：\n" +
            result.log.slice(-1500),
        },
        { status: 500 },
      );
    }

    const zip = await (await import("node:fs/promises")).readFile(result.zipPath);
    const filename = path.basename(result.zipPath);
    await (await import("node:fs/promises")).rm(outDir, {
      recursive: true,
      force: true,
    }).catch(() => {});

    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Hydro 导出失败：${(error as Error).message}` },
      { status: 500 },
    );
  }
}
