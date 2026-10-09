"use client";

import { Moon, Sun } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

/**
 * Theme toggle: light / dark / auto, persisted in localStorage.
 *
 * taste-skill Section 4.11 (Page Theme Lock): the page has ONE theme at a
 * time, chosen at the root and locked. This toggle changes the whole page at
 * once - it never flips individual sections. "auto" follows the OS, which is
 * the skill's default; the toggle exists because a user on a dark-mode OS
 * may still want this surface light, and vice versa.
 *
 * The actual class flip happens in the inline script in layout.tsx (before
 * first paint, to avoid a flash) and in the effect below (on user action).
 */

type Mode = "light" | "dark" | "auto";

const STORAGE_KEY = "acm-theme";

function apply(mode: Mode): void {
  const dark =
    mode === "dark" ||
    (mode === "auto" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("theme-dark", dark);
  document.documentElement.classList.toggle("theme-light", !dark);
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("auto");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) as Mode | null;
    if (saved === "light" || saved === "dark" || saved === "auto") {
      setMode(saved);
      apply(saved);
    } else {
      apply("auto");
    }
  }, []);

  // Follow OS changes while in auto mode.
  useEffect(() => {
    if (mode !== "auto") {
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("auto");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  const cycle = () => {
    const next: Mode =
      mode === "auto" ? "light" : mode === "light" ? "dark" : "auto";
    setMode(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    apply(next);
  };

  const label =
    mode === "auto" ? "跟随系统" : mode === "light" ? "浅色" : "深色";

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`主题：${label}，点击切换`}
      title={`主题：${label}`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors duration-300 hover:bg-inset hover:text-ink focus-ring"
    >
      {mode === "dark" ? (
        <Moon size={18} weight="fill" />
      ) : (
        <Sun size={18} weight={mode === "auto" ? "duotone" : "fill"} />
      )}
    </button>
  );
}
