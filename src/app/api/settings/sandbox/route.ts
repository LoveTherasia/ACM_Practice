import { NextResponse } from "next/server";

import { sandboxStatus } from "@/lib/sandbox/docker";

export const dynamic = "force-dynamic";

/** Reports whether untrusted-code execution is safely available. */
export async function GET() {
  return NextResponse.json(await sandboxStatus());
}
