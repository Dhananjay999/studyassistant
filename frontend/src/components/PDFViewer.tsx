import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Maximize2,
  PanelLeft,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  url: string;
  fileName?: string;
  /** Page to jump to once the document loads (1-based), e.g. from a citation. */
  initialPage?: number;
  onClose: () => void;
}

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 4;
const DEFAULT_ASPECT = 1.414; // A4 portrait height/width, used for skeletons.

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function touchDistance(touches: React.TouchList): number {
  const [a, b] = [touches[0], touches[1]];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Mobile-first PDF viewer: continuous vertical scroll, fit-to-width by default,
 * pinch-to-zoom, a live page indicator, lazy page rendering, and an optional
 * desktop thumbnail rail — closer to Google Drive than a single-page pager.
 */
export default function PDFViewer({
  url,
  fileName,
  initialPage,
  onClose,
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const [showThumbs, setShowThumbs] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const jumpedRef = useRef(false);

  // Track the available width so pages fit it (minus padding).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const baseWidth = Math.max(280, containerWidth - 32);
  const pageWidth = Math.round(baseWidth * zoom);

  const onDocLoad = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      // Honour an initial page (citation jump); otherwise start at the top.
      setCurrentPage(initialPage ? clamp(initialPage, 1, n) : 1);
    },
    [initialPage],
  );

  // Scroll to the cited page once the page placeholders are laid out. Runs
  // once; the placeholders exist immediately so the target is always present.
  useEffect(() => {
    if (!numPages || !initialPage || jumpedRef.current) return undefined;
    jumpedRef.current = true;
    const target = clamp(initialPage, 1, numPages);
    const t = window.setTimeout(() => {
      scrollRef.current
        ?.querySelector(`[data-page="${target}"]`)
        ?.scrollIntoView({ block: "start" });
    }, 100);
    return () => window.clearTimeout(t);
  }, [numPages, initialPage]);

  const onFirstPageLoad = useCallback(
    ({ width, height }: { width: number; height: number }) => {
      if (width > 0) setAspect(height / width);
    },
    [],
  );

  // Center-band observer: the page crossing the viewport middle is "current".
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !numPages) return undefined;
    const obs = new IntersectionObserver(
      (entries) => {
        let best = 0;
        let bestRatio = 0;
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            best = Number(e.target.getAttribute("data-page"));
          }
        }
        if (best) setCurrentPage(best);
      },
      { root, threshold: [0.2, 0.5, 0.8] },
    );
    const nodes = root.querySelectorAll("[data-page]");
    nodes.forEach((n) => obs.observe(n));
    return () => obs.disconnect();
  }, [numPages, pageWidth]);

  const scrollToPage = (n: number) => {
    const root = scrollRef.current;
    const el = root?.querySelector(`[data-page="${n}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const zoomIn = () => setZoom((z) => clamp(z + 0.25, MIN_ZOOM, MAX_ZOOM));
  const zoomOut = () => setZoom((z) => clamp(z - 0.25, MIN_ZOOM, MAX_ZOOM));
  const fit = () => setZoom(1);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinch.current = { dist: touchDistance(e.touches), zoom };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinch.current) {
      const ratio = touchDistance(e.touches) / pinch.current.dist;
      setZoom(clamp(pinch.current.zoom * ratio, MIN_ZOOM, MAX_ZOOM));
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) pinch.current = null;
  };

  const loader = (
    <div className="flex items-center justify-center p-8">
      <Loader2 className="h-7 w-7 animate-spin text-white/80" />
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col bg-neutral-950"
    >
      {/* Header */}
      <div className="flex items-center gap-1 border-b border-white/10 px-2 py-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:px-3">
        {numPages > 1 && (
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-9 w-9 text-white md:inline-flex"
            onClick={() => setShowThumbs((s) => !s)}
            aria-label="Toggle thumbnails"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        )}
        <span className="flex-1 truncate px-1 text-sm font-medium text-white">
          {fileName || "PDF"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-white"
          onClick={zoomOut}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="min-w-[3rem] text-center text-xs tabular-nums text-white">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-white"
          onClick={zoomIn}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden h-9 w-9 text-white sm:inline-flex"
          onClick={fit}
          aria-label="Fit width"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-white"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <Document
        file={url}
        onLoadSuccess={onDocLoad}
        loading={
          <div className="flex flex-1 items-center justify-center">{loader}</div>
        }
        error={
          <div className="flex flex-1 items-center justify-center p-8 text-center text-white/70">
            Failed to load PDF.
          </div>
        }
        className="flex min-h-0 flex-1"
      >
        {/* Desktop thumbnail rail */}
        {numPages > 1 && showThumbs && (
          <div className="hidden w-32 shrink-0 overflow-y-auto border-r border-white/10 bg-black/30 p-2 md:block">
            <div className="flex flex-col gap-2">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => scrollToPage(n)}
                  className={cn(
                    "overflow-hidden rounded-md border bg-white/5 transition-colors",
                    n === currentPage
                      ? "border-brand-1 ring-1 ring-brand-1"
                      : "border-white/10 hover:border-white/30",
                  )}
                >
                  <LazyPage pageNumber={n} width={104} aspect={aspect} thumb />
                  <span className="block py-0.5 text-center text-[10px] text-white/60">
                    {n}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Main scrollable continuous view */}
        <div
          ref={scrollRef}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ touchAction: "pan-y" }}
          className="flex-1 overflow-auto overscroll-contain p-4"
        >
          <div className="mx-auto flex flex-col items-center gap-4">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
              <LazyPage
                key={n}
                pageNumber={n}
                width={pageWidth}
                aspect={aspect}
                onLoad={n === 1 ? onFirstPageLoad : undefined}
              />
            ))}
          </div>
        </div>
      </Document>

      {/* Page indicator + jump */}
      {numPages > 0 && (
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-white"
            onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
          >
            <ChevronUp className="h-4 w-4" /> Prev
          </Button>
          <span className="text-xs tabular-nums text-white">
            Page {currentPage} of {numPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-white"
            onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))}
            disabled={currentPage >= numPages}
          >
            Next <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      )}
    </motion.div>
  );
}

/** A page that only renders its canvas once scrolled near the viewport. */
function LazyPage({
  pageNumber,
  width,
  aspect,
  thumb = false,
  onLoad,
}: {
  pageNumber: number;
  width: number;
  aspect: number;
  thumb?: boolean;
  onLoad?: (size: { width: number; height: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: thumb ? "300px 0px" : "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [thumb]);

  const height = Math.round(width * aspect);

  return (
    <div
      ref={ref}
      data-page={thumb ? undefined : pageNumber}
      style={{ width }}
      className={cn(!thumb && "shadow-xl")}
    >
      {visible ? (
        <Page
          pageNumber={pageNumber}
          width={width}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          onLoadSuccess={
            onLoad
              ? (p) => onLoad({ width: p.originalWidth, height: p.originalHeight })
              : undefined
          }
          loading={
            <div
              style={{ height }}
              className="w-full animate-pulse bg-white/5"
            />
          }
        />
      ) : (
        <div
          style={{ height }}
          className="w-full animate-pulse rounded bg-white/5"
        />
      )}
    </div>
  );
}
