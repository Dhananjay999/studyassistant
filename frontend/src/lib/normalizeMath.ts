// Models often emit LaTeX with `\( … \)` (inline) and `\[ … \]` (block)
// delimiters, but remark-math only recognises `$ … $` / `$$ … $$`. Convert the
// former to the latter so KaTeX renders fractions/roots/integrals/etc. instead
// of showing the raw source. Used by both the chat MarkdownContent and the
// lightweight MathText (quiz/flashcards).
export function normalizeMath(text: string): string {
  if (!text || (!text.includes("\\(") && !text.includes("\\["))) return text;
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, expr) => `$$${expr}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, expr) => `$${expr}$`);
}
