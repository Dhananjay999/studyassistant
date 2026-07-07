import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "katex/dist/contrib/mhchem";
import { normalizeMath } from "@/lib/normalizeMath";
import { cn } from "@/lib/utils";

const REMARK = [remarkMath];
const REHYPE = [rehypeKatex];

/**
 * Inline LaTeX renderer for short surfaces — quiz prompts/options, flashcard
 * front/back/example. Renders `$…$` / `$$…$$` (fractions, roots, super/sub,
 * integrals, summations, matrices) and `\ce{…}` chemistry via KaTeX, so maths
 * shows the same everywhere as it does in chat — but WITHOUT chat's heavier
 * citation / link / document-viewer machinery.
 *
 * Paragraph wrapping is stripped so it drops into an existing text node (a
 * label, heading, or centered card face) without changing the layout.
 */
export function MathText({
  children,
  className,
}: {
  children?: string | null;
  className?: string;
}) {
  return (
    <span className={cn("[&_.katex-display]:my-1", className)}>
      <ReactMarkdown
        remarkPlugins={REMARK}
        rehypePlugins={REHYPE}
        components={{ p: ({ children }) => <>{children}</> }}
      >
        {normalizeMath(children ?? "")}
      </ReactMarkdown>
    </span>
  );
}
