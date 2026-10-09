import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ConsoleShell } from "@/components/console/console-shell";
import { ConsoleTheme } from "@/components/console/console-theme";

export const metadata: Metadata = {
  title: "出题控制台",
  description: "浏览题目工作区、查看验题状态、启动造题流水线。",
};

/**
 * The console is the only subtree that touches Carbon.
 *
 * taste-skill Section 4.11 wants the theme set once at the root of the surface
 * that owns it, so Carbon's Theme wrapper lives here rather than being applied
 * inside individual pages. The marketing route group never imports it, which is
 * what keeps the two surfaces from bleeding into each other.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleTheme>
      <ConsoleShell>{children}</ConsoleShell>
    </ConsoleTheme>
  );
}