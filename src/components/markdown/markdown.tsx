import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

import "katex/dist/katex.min.css";

/**
 * Markdown renderer for problem statements and tutorials.
 *
 * The pipeline's docs are GitHub-flavoured Markdown with $...$ / $$...$$
 * math (the skill mandates that notation), so this wires up GFM tables,
 * math parsing and KaTeX rendering. Styling stays inside the design tokens:
 * no imported typography, just the same ink/surface/accent scale the rest
 * of the console uses (taste-skill Section 4.2, one palette).
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body max-w-none text-sm leading-relaxed text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
