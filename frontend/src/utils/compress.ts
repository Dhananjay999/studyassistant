// Shrinks a picked file before upload without changing what it shows. Every
// path falls back to the original file: a result is used only when it is
// smaller and still intact, and a failure here never fails the upload.

import imageCompression from "browser-image-compression";
import { inspectPdf } from "@/lib/pdfInspect";

const MB = 1024 * 1024;
// Small files are sent untouched: there is little to save.
const SKIP_BELOW_BYTES = 1 * MB;
// The server stores images at this size, so scaling to it here loses nothing
// the server would have kept.
const IMAGE_MAX_DIMENSION = 2048;
const IMAGE_TARGET_MB = 2;
const IMAGE_QUALITY = 0.85;
// A repacked PDF must save at least this share to be worth swapping in.
const PDF_MIN_SAVING = 0.03;

// GIF is left alone: re-encoding would drop its animation.
const COMPRESSIBLE_IMAGES = ["image/jpeg", "image/png", "image/webp"];
const PDF_TYPE = "application/pdf";

async function compressImage(file: File): Promise<File> {
  const out = await imageCompression(file, {
    maxSizeMB: IMAGE_TARGET_MB,
    maxWidthOrHeight: IMAGE_MAX_DIMENSION,
    initialQuality: IMAGE_QUALITY,
    fileType: file.type,
    useWebWorker: true,
  });
  if (out.size >= file.size) return file;
  // Some browsers hand back a bare Blob, which would upload under the name
  // "blob": keep the name the student's file had.
  return out instanceof File && out.name === file.name
    ? out
    : new File([out], file.name, {
        type: out.type || file.type,
        lastModified: file.lastModified,
      });
}

/**
 * Repack a PDF losslessly: the page content, images and fonts are copied
 * byte for byte and only the file's internal bookkeeping is compressed.
 * The repacked file is used only when it opens with the same page count.
 */
async function compressPdf(file: File): Promise<File> {
  const { PDFDocument } = await import("pdf-lib");
  // Strict parsing: a file with objects that cannot be read is left as is
  // instead of being rewritten without them. Encrypted files throw here too.
  const doc = await PDFDocument.load(await file.arrayBuffer(), {
    updateMetadata: false,
    throwOnInvalidObject: true,
  });
  const bytes = await doc.save({ useObjectStreams: true });
  if (bytes.byteLength > file.size * (1 - PDF_MIN_SAVING)) return file;

  const out = new File([bytes], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
  const [before, after] = await Promise.all([inspectPdf(file), inspectPdf(out)]);
  const intact = before.pages !== null && before.pages === after.pages;
  return intact ? out : file;
}

/** Return a smaller equivalent of the file, or the file itself. */
export async function compressFile(file: File): Promise<File> {
  if (file.size <= SKIP_BELOW_BYTES) return file;
  try {
    if (COMPRESSIBLE_IMAGES.includes(file.type)) return await compressImage(file);
    if (file.type === PDF_TYPE) return await compressPdf(file);
  } catch {
    /* fall through to the original */
  }
  return file;
}

// Camera shots and pasted images reach us as "blob", "image.jpg" or a name
// with no extension; stored as-is they are unrecognisable in the file list
// and cite as "blob". Name them before upload from the type and the time.
const UNNAMED_BASENAMES = new Set(["", "blob", "image", "file", "photo", "capture"]);
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

/** True when the picked file carries no usable name (camera / paste). */
export function isUnnamedFile(file: File): boolean {
  const name = (file.name || "").trim();
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).trim().toLowerCase();
  return dot <= 0 || UNNAMED_BASENAMES.has(base);
}

/**
 * Give an unnamed file a readable name such as `Photo 3 · 14:27.jpg`
 * (`index` is its 1-based position in the batch; omitted for a single file).
 * Named files are returned untouched, bytes are never copied.
 */
export function ensureFileName(file: File, index?: number): File {
  if (!isUnnamedFile(file)) return file;
  const kind = file.type.startsWith("image/")
    ? "Photo"
    : file.type === PDF_TYPE
      ? "Document"
      : "File";
  const ext =
    EXT_BY_MIME[file.type] ??
    ((file.name || "").includes(".") ? file.name.split(".").pop() : "") ??
    "";
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const label = `${kind}${index ? ` ${index}` : ""} · ${hh}:${mm}`;
  return new File([file], ext ? `${label}.${ext}` : label, {
    type: file.type,
    lastModified: file.lastModified,
  });
}
