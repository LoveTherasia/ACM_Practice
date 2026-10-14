import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/training/audit - the dataset quality report.
 *
 * Duplicates, near-duplicates, category x difficulty distribution, and
 * malformed lines. Read-only.
 *
 * POST /api/settings/training/audit - deduplicate in place.
 *
 * Removes exact duplicates (same role + user prompt), keeping the first
 * occurrence. The audit should be reviewed before running this.
 */
export async function GET() {
  try {
    const { auditDataset } = await import("@/lib/training/audit");
    const report = await auditDataset();
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: `审计失败：${(error as Error).message}` },
      { status: 500 },
    );
  }
}

const actionSchema = z.object({
  action: z.enum(["dedupe", "prune-placeholders"]),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "仅支持 {\"action\": \"dedupe\"} 或 {\"action\": \"prune-placeholders\"}" },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.action === "prune-placeholders") {
      const { prunePlaceholderSamples } = await import("@/lib/training/audit");
      const result = await prunePlaceholderSamples();
      return NextResponse.json(result);
    }
    const { dedupeDataset } = await import("@/lib/training/audit");
    const result = await dedupeDataset();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: `操作失败：${(error as Error).message}` },
      { status: 500 },
    );
  }
}
