// Convert LaTeX-ish math into readable Unicode plain text for surfaces that
// CANNOT render KaTeX — chiefly the jsPDF quiz export, whose vector text engine
// draws characters, not rendered math. Rich surfaces (chat/quiz/flashcards on
// screen) use real KaTeX via MathText; this is the print/plain-text fallback so
// an exported quiz shows "(a+b)/c" and "√(x)" instead of "\( \frac{a+b}{c} \)".

const SYMBOLS: Record<string, string> = {
  times: "×", div: "÷", cdot: "·", pm: "±", mp: "∓",
  leq: "≤", geq: "≥", neq: "≠", approx: "≈", equiv: "≡", propto: "∝",
  infty: "∞", deg: "°", to: "→", rightarrow: "→", leftarrow: "←",
  Rightarrow: "⇒", Leftarrow: "⇐", sum: "Σ", prod: "∏", int: "∫",
  partial: "∂", nabla: "∇", forall: "∀", exists: "∃", in: "∈", notin: "∉",
  subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩", emptyset: "∅",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ",
  mu: "μ", nu: "ν", xi: "ξ", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ",
  chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ",
  Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  ldots: "…", cdots: "…", dots: "…", angle: "∠", perp: "⊥", parallel: "∥",
};

export function latexToText(input: string): string {
  if (!input || !/[\\${}^_]/.test(input)) return input;
  let s = input;

  // Strip math delimiters: \( \) \[ \] $$ $
  s = s.replace(/\\[()[\]]/g, "").replace(/\${1,2}/g, "");

  // Fractions (a few passes for nesting): \frac{A}{B} -> (A)/(B)
  const frac = /\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g;
  for (let i = 0; i < 4 && frac.test(s); i++) {
    s = s.replace(frac, "($1)/($2)");
  }

  // Roots and text-ish wrappers.
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
  s = s.replace(
    /\\(?:text|mathrm|mathbf|mathit|mathsf|operatorname)\s*\{([^{}]*)\}/g,
    "$1",
  );

  // Super/subscripts: keep braces contents. x^{n+1} -> x^(n+1); x^2 stays.
  s = s.replace(/\^\{([^{}]*)\}/g, "^($1)").replace(/_\{([^{}]*)\}/g, "_($1)");

  // Sizing + thin-space commands.
  s = s.replace(/\\left|\\right|\\big[lr]?|\\!/g, "");
  s = s.replace(/\\[,;:> ]/g, " ");

  // Named symbols → Unicode; unknown \command → its bare name.
  s = s.replace(/\\([a-zA-Z]+)/g, (_m, name: string) => SYMBOLS[name] ?? name);

  // Drop any leftover braces, collapse whitespace.
  s = s.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  return s;
}
