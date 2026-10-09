"use client";

import { List, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";

const LINKS = [
  { href: "/#pipeline", label: "工作原理" },
  { href: "/#artifacts", label: "产物" },
  { href: "/#verification", label: "验题" },
];

/**
 * Sticky site nav.
 *
 * One line at desktop and 64px tall, inside the 80px ceiling from Section 4.7.
 * The CTA label is identical everywhere on the page because Section 4.5 forbids
 * two different labels expressing the same intent.
 */
export function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
      <nav
        aria-label="主导航"
        className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-4 sm:px-6 lg:px-8"
      >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight"
        >
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-[3px] bg-accent"
          />
          ACM Practice
        </Link>

        {/* Hidden below md, so the desktop bar never wraps to two lines. */}
        <ul className="hidden items-center gap-7 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="text-sm text-muted transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:text-ink"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/console"
            className="hidden rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] sm:inline-flex"
          >
            打开控制台
          </Link>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "关闭导航" : "打开导航"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted transition-colors duration-300 hover:bg-inset hover:text-ink md:hidden"
          >
            {open ? <X size={20} /> : <List size={20} />}
          </button>
        </div>
      </nav>

      {/* Explicit mobile collapse rather than trusting the utilities. */}
      {open ? (
        <div id="mobile-nav" className="border-t border-line md:hidden">
          <ul className="mx-auto flex max-w-[1400px] flex-col px-4 py-2">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-2 py-3 text-sm text-muted hover:bg-inset hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="px-0 pt-2 pb-3 sm:hidden">
              <Link
                href="/console"
                onClick={() => setOpen(false)}
                className="block rounded-md bg-accent px-4 py-2.5 text-center text-sm font-medium text-on-accent"
              >
                打开控制台
              </Link>
            </li>
          </ul>
        </div>
      ) : null}
    </header>
  );
}