// Line-level diff for the Prompt Map's version history: which lines of a
// template changed between a stored version and the one deployed now.
//
// Plain LCS (longest common subsequence) over lines, after trimming the
// common head and tail so the quadratic table only covers the part that
// actually differs. Prompt templates are a few hundred lines at most; the
// cell cap is a guard, not an expected path. No dependency on purpose.

export type DiffOp = "same" | "add" | "del";

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** 1-based line number in the old text (null for added lines). */
  oldNo: number | null;
  /** 1-based line number in the new text (null for removed lines). */
  newNo: number | null;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** True when the texts were too large for the LCS table and the changed
   * middle is reported as one removed block followed by one added block. */
  coarse: boolean;
}

/** A run of unchanged lines folded out of the view. */
export interface DiffGap {
  op: "gap";
  count: number;
}

export type DiffRow = DiffLine | DiffGap;

/** Largest LCS table (rows x columns) built before falling back. */
const MAX_CELLS = 4_000_000;

/** Split into lines; an empty text has no lines (not one empty line). */
export function splitLines(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.replace(/\r\n?/g, "\n").split("\n");
}

/** Diff `oldText` against `newText`, line by line. */
export function diffLines(
  oldText: string | null | undefined,
  newText: string | null | undefined,
  maxCells: number = MAX_CELLS,
): DiffResult {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const n = a.length - head - tail;
  const m = b.length - head - tail;
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let oldNo = 0;
  let newNo = 0;

  const same = (text: string) => {
    oldNo++;
    newNo++;
    lines.push({ op: "same", text, oldNo, newNo });
  };
  const del = (text: string) => {
    oldNo++;
    removed++;
    lines.push({ op: "del", text, oldNo, newNo: null });
  };
  const add = (text: string) => {
    newNo++;
    added++;
    lines.push({ op: "add", text, oldNo: null, newNo });
  };

  for (let i = 0; i < head; i++) same(a[i]);

  const coarse = n > 0 && m > 0 && (n + 1) * (m + 1) > maxCells;
  if (coarse || n === 0 || m === 0) {
    // Nothing to align (pure insertion / removal), or too large to align.
    for (let i = 0; i < n; i++) del(a[head + i]);
    for (let j = 0; j < m; j++) add(b[head + j]);
  } else {
    // lcs[i * width + j] = LCS length of a[head+i..] and b[head+j..].
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] =
          a[head + i] === b[head + j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[head + i] === b[head + j]) {
        same(a[head + i]);
        i++;
        j++;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
        // Ties remove first, so a rewritten line reads "old, then new".
        del(a[head + i]);
        i++;
      } else {
        add(b[head + j]);
        j++;
      }
    }
    for (; i < n; i++) del(a[head + i]);
    for (; j < m; j++) add(b[head + j]);
  }

  for (let i = 0; i < tail; i++) same(a[a.length - tail + i]);

  return { lines, added, removed, coarse };
}

/**
 * Fold long runs of unchanged lines, keeping `context` lines around every
 * change. Returns no rows when nothing changed.
 */
export function collapseUnchanged(lines: DiffLine[], context = 3): DiffRow[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].op === "same") continue;
    changed = true;
    const from = Math.max(0, i - context);
    const to = Math.min(lines.length - 1, i + context);
    for (let k = from; k <= to; k++) keep[k] = true;
  }
  if (!changed) return [];

  const rows: DiffRow[] = [];
  let hidden = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) {
      if (hidden > 0) {
        rows.push({ op: "gap", count: hidden });
        hidden = 0;
      }
      rows.push(lines[i]);
    } else {
      hidden++;
    }
  }
  if (hidden > 0) rows.push({ op: "gap", count: hidden });
  return rows;
}
