import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * GET /api/recycle - the failed-problem recycling report.
 *
 * Scans every workspace, classifies it (passed / failed / never-verified /
 * unparseable), and runs the preflight suite on the non-passing ones to
 * produce an actionable repair ticket per problem. The preflight compiles
 * generators inside the sandbox, so a full scan of a large registry takes
 * minutes; the console shows a loading state.
 */
export async function GET() {
  try {
    const { recycleReport } = await import("@/lib/problems/recycle");
    const report = await recycleReport();
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: `回收扫描失败：${(error as Error).message}` },
      { status: 500 },
    );
  }
}
