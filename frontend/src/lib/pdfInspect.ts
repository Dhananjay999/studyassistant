// Read-only PDF checks that run in the browser before an upload, using the
// same pdf.js build as the document viewer (loaded on demand). Every check is
// best-effort: when pdf.js cannot be loaded or takes too long the answer is
// "unknown" (null), never a rejection.

const INSPECT_TIMEOUT_MS = 8000;

export type PdfProblem = "password_protected" | "corrupt_file";

export interface PdfInspection {
  /** A cause that makes the file unusable, when one is certain. */
  problem: PdfProblem | null;
  /** Page count, or null when the file could not be opened. */
  pages: number | null;
}

const UNKNOWN: PdfInspection = { problem: null, pages: null };

async function open(data: ArrayBuffer): Promise<PdfInspection> {
  const { pdfjs } = await import("react-pdf");
  // Same worker the viewer uses (see components/PDFViewer.tsx).
  pdfjs.GlobalWorkerOptions.workerSrc ||= `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data });
  try {
    const doc = await task.promise;
    return { problem: null, pages: doc.numPages };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    // Thrown only when a password is needed to open the file; PDFs that are
    // encrypted just to restrict printing or copying open normally.
    if (name === "PasswordException") {
      return { problem: "password_protected", pages: null };
    }
    if (name === "InvalidPDFException") {
      return { problem: "corrupt_file", pages: null };
    }
    return UNKNOWN;
  } finally {
    void task.destroy();
  }
}

/** Open a PDF to learn whether it is locked or damaged, and its page count. */
export async function inspectPdf(file: Blob): Promise<PdfInspection> {
  try {
    const data = await file.arrayBuffer();
    return await Promise.race([
      open(data),
      new Promise<PdfInspection>((resolve) =>
        setTimeout(() => resolve(UNKNOWN), INSPECT_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return UNKNOWN;
  }
}
