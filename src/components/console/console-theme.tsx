"use client";

import { Theme } from "@carbon/react";
import { useEffect, useState } from "react";

/**
 * Resolve Carbon's theme from the shared theme choice.
 *
 * taste-skill Section 4.11: one theme per page, set once at the root of the
 * surface that owns it. The console reads the same "acm-theme" localStorage
 * key the marketing ThemeToggle writes, so both surfaces always agree.
 * "auto" (the default) follows prefers-color-scheme.
 *
 * The choice is made in an effect rather than during render because reading
 * matchMedia/localStorage during the first server render would desynchronise
 * the markup from the client and trip hydration.
 */
export function ConsoleTheme({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<"white" | "g100">("white");

  useEffect(() => {
    const resolve = () => {
      let mode: string | null = null;
      try {
        mode = window.localStorage.getItem("acm-theme");
      } catch {
        mode = null;
      }
      if (mode === "dark") {
        return "g100" as const;
      }
      if (mode === "light") {
        return "white" as const;
      }
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? ("g100" as const)
        : ("white" as const);
    };

    const apply = () => setTheme(resolve());
    apply();

    // Follow OS changes while in auto mode, and storage events so the
    // toggle on the marketing surface propagates into the console.
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", apply);
    window.addEventListener("storage", apply);
    return () => {
      query.removeEventListener("change", apply);
      window.removeEventListener("storage", apply);
    };
  }, []);

  return <Theme theme={theme}>{children}</Theme>;
}
