import { NextResponse } from "next/server";

import { listProblems } from "@/lib/problems/store";

export const dynamic = "force-dynamic";

/** GET /api/problems - the console registry. */
export async function GET() {
  const entries = await listProblems();
  return NextResponse.json({ entries });
}