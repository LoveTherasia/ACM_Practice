import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

import { z } from "@/lib/design/layers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ACM Practice · AI 自主出题流水线",
    template: "%s · ACM Practice",
  },
  description:
    "把一个 idea 落成完整、可本地验证、可继续迭代的 ICPC 题目工作区：题面、题解、标程、错解、generator、validator 与 checker 一次生成，并跑通本地验题。",
  applicationName: "ACM Practice",
  keywords: ["ICPC", "OI", "出题", "命题", "题库", "generator", "validator"],
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning is required here: the inline script below
    // adds theme-dark / theme-light to <html> before React hydrates, so the
    // class attribute legitimately differs between server and client on this
    // one element. React only suppresses the warning for this element's own
    // attributes - children still hydrate strictly. This is the same pattern
    // next-themes and the Next.js docs use for theme scripts.
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply the saved theme before first paint. Without this, a
            dark-mode user with a saved light preference sees one dark
            flash before the class lands. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem("acm-theme");var d=m==="dark"||(m!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var c=document.documentElement.classList;d?c.add("theme-dark"):c.add("theme-light");}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-on-accent"
        >
          跳到主要内容
        </a>
        {children}
        <ZIndexLegend />
      </body>
    </html>
  );
}

/**
 * A dev-only readout of the z-index scale.
 *
 * Section 6.F asks for the scale to live in a documented constants file rather
 * than as arbitrary z-50s scattered through components. Rendering it in the
 * corner keeps that promise visible and makes accidental layering obvious.
 */
function ZIndexLegend() {
  return (
    <details className="fixed right-2 bottom-2 z-[80] hidden text-[10px] leading-tight lg:block">
      <summary className="cursor-pointer list-none rounded-md border border-line bg-raised px-2 py-1 text-subtle shadow-card">
        z-index
      </summary>
      <dl className="mt-1 rounded-md border border-line bg-raised px-2 py-1.5 text-subtle shadow-panel">
        {Object.entries(z).map(([name, value]) => (
          <div key={name} className="flex gap-3 tabular-nums">
            <dt className="font-mono">{name}</dt>
            <dd className="font-mono">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}