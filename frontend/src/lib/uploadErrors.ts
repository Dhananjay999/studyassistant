// Why an upload failed: one closed set of causes shared by the upload card
// (its message, and whether Retry can help) and analytics (`reason`). The
// checks here find the cause in the browser, before any bytes are sent; what
// the server still refuses is named from its status and message.

import { inspectPdf } from "@/lib/pdfInspect";

const PDF_TYPE = "application/pdf";
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Mirrors the backend's ALLOWED_TYPES (`aeva/media/media_repository.py`). */
export const ACCEPTED_UPLOAD_TYPES: readonly string[] = [
  ...IMAGE_TYPES,
  PDF_TYPE,
];
/** `accept` value for the file inputs, so pickers grey out other formats. */
export const UPLOAD_ACCEPT = ACCEPTED_UPLOAD_TYPES.join(",");

// The hosting platform refuses a request body above about 4.5 MB before the
// backend runs, so a larger file can never arrive whatever the backend allows.
// A little room is left for the multipart envelope around the file.
const PLATFORM_BODY_LIMIT_MB = 4.4;
/** The backend's MAX_UPLOAD_MB, capped at what the platform lets through. */
export const MAX_UPLOAD_MB = Math.min(
  Number(import.meta.env.VITE_MAX_UPLOAD_MB) || 10,
  PLATFORM_BODY_LIMIT_MB,
);
const MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const PDF_HEADER = "%PDF-";
const PDF_HEADER_WINDOW = 1024;

export type UploadFailureReason =
  | "unsupported_type"
  | "too_large"
  | "empty_file"
  | "corrupt_file"
  | "password_protected"
  | "network"
  | "unauthorized"
  | "server_error"
  | "unknown";

/** Where the failure was caught: in the browser before sending, or by the server. */
export type UploadFailureStage = "preflight" | "upload";

interface ReasonMeta {
  message: string;
  /** False when sending the same file again cannot succeed. */
  retryable: boolean;
}

export const UPLOAD_FAILURES: Record<UploadFailureReason, ReasonMeta> = {
  unsupported_type: {
    message: "This file type isn't supported. Upload a PDF, JPG, PNG, WebP or GIF.",
    retryable: false,
  },
  too_large: {
    message: `This file is too large (the limit is ${MAX_UPLOAD_MB} MB). Try a smaller or compressed version.`,
    retryable: false,
  },
  empty_file: {
    message: "This file is empty. Check it and upload it again.",
    retryable: false,
  },
  corrupt_file: {
    message: "This file is damaged and can't be opened. Try exporting it again.",
    retryable: false,
  },
  password_protected: {
    message: "This PDF is password-protected. Remove the password and upload it again.",
    retryable: false,
  },
  network: {
    message: "The upload was interrupted. Check your connection and retry.",
    retryable: true,
  },
  unauthorized: {
    message: "Your session expired. Sign in again to upload.",
    retryable: true,
  },
  server_error: {
    message: "The upload failed on our side. Please retry.",
    retryable: true,
  },
  unknown: { message: "The upload failed. Please retry.", retryable: true },
};

/** A failed upload request, carrying its cause and what the server said. */
export class UploadError extends Error {
  readonly reason: UploadFailureReason;
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number;

  constructor(reason: UploadFailureReason, status = 0) {
    super(UPLOAD_FAILURES[reason].message);
    this.name = "UploadError";
    this.reason = reason;
    this.status = status;
  }
}

/** Name the cause of a non-2xx upload response. */
export function reasonFromResponse(
  status: number,
  serverMessage = "",
): UploadFailureReason {
  // A body over the hosting platform's limit is refused before our code runs.
  if (status === 413) return "too_large";
  if (status === 415) return "unsupported_type";
  if (status === 401) return "unauthorized";
  // The backend reports every validation failure as a 400 and describes the
  // cause only in its message.
  if (/unsupported/i.test(serverMessage)) return "unsupported_type";
  if (/exceeds max size/i.test(serverMessage)) return "too_large";
  if (status === 429 || status >= 500) return "server_error";
  return "unknown";
}

/** Normalize anything thrown by the upload request into an UploadError. */
export function toUploadError(error: unknown): UploadError {
  return error instanceof UploadError ? error : new UploadError("unknown");
}

async function hasPdfHeader(file: File): Promise<boolean> {
  const head = await file.slice(0, PDF_HEADER_WINDOW).arrayBuffer();
  return new TextDecoder("latin1").decode(head).includes(PDF_HEADER);
}

/** Whether the browser can decode the image (true when it cannot tell). */
async function imageDecodes(file: File): Promise<boolean> {
  if (typeof createImageBitmap !== "function") return true;
  try {
    (await createImageBitmap(file)).close();
    return true;
  } catch {
    return false;
  }
}

async function pdfProblem(file: File): Promise<UploadFailureReason | null> {
  try {
    if (!(await hasPdfHeader(file))) return "corrupt_file";
  } catch {
    // The browser could not read the file at all.
    return "corrupt_file";
  }
  return (await inspectPdf(file)).problem;
}

/**
 * Check a picked file before anything is sent. Returns the cause when the
 * file certainly cannot be used, otherwise null. Size is checked separately
 * (`exceedsUploadLimit`) once the file has been compressed.
 */
export async function preflightUpload(
  file: File,
): Promise<UploadFailureReason | null> {
  if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) return "unsupported_type";
  if (file.size === 0) return "empty_file";
  if (file.type === PDF_TYPE) return pdfProblem(file);
  return (await imageDecodes(file)) ? null : "corrupt_file";
}

/** Whether the file to be sent is over the upload limit. */
export const exceedsUploadLimit = (file: File) => file.size > MAX_BYTES;

export type ProcessingFailureReason =
  | "parse_failed"
  | "parse_timeout"
  | "not_found"
  | "unexpected"
  | "unknown";

const PARSE_FAILED_MESSAGE =
  "We couldn't read this file. It may be damaged — try exporting it again.";

/**
 * Name the cause of a failed processing run from the backend's message, and
 * give the copy to show for it. Unrecognized messages are shown as sent.
 */
export function processingFailure(serverMessage: string): {
  reason: ProcessingFailureReason;
  message: string;
} {
  if (/did not complete/i.test(serverMessage)) {
    return { reason: "parse_failed", message: PARSE_FAILED_MESSAGE };
  }
  if (/taking longer/i.test(serverMessage)) {
    return { reason: "parse_timeout", message: serverMessage };
  }
  if (/not found/i.test(serverMessage)) {
    return { reason: "not_found", message: serverMessage };
  }
  if (/unexpectedly/i.test(serverMessage)) {
    return { reason: "unexpected", message: serverMessage };
  }
  return { reason: "unknown", message: serverMessage };
}
