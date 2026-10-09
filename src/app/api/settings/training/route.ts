import { NextResponse } from "next/server";

import { countSamples } from "@/lib/training/dataset";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/training - the local-model training status.
 *
 * The settings page shows how much verified data has accumulated, because
 * the fine-tune is only worth running once the corpus is big enough
 * (rough rule of thumb: 200+ verified samples across 30+ problems).
 */
export async function GET() {
  const stats = await countSamples();
  const ready = stats.verified >= 200;
  return NextResponse.json({
    ...stats,
    ready,
    advice: ready
      ? "样本量已足够，可以开始微调。运行 training/finetune.py。"
      : `已验证样本 ${stats.verified} 条（建议 >= 200）。继续用云端模型造题积累数据。`,
  });
}
