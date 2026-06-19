import { useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { motion } from "framer-motion";
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  url: string;
  fileName?: string;
  onClose: () => void;
}

export default function PDFViewer({ url, fileName, onClose }: PDFViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  const onLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  }, []);

  const prevPage = () => setPageNumber((p) => Math.max(1, p - 1));
  const nextPage = () => setPageNumber((p) => Math.min(numPages, p + 1));
  const zoomIn = () => setScale((s) => Math.min(3, s + 0.2));
  const zoomOut = () => setScale((s) => Math.max(0.4, s - 0.2));
  const rotate = () => setRotation((r) => (r + 90) % 360);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 safe-top">
        <span className="flex-1 truncate text-sm font-medium text-white">
          {fileName || "PDF"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white"
          onClick={zoomOut}
          disabled={scale <= 0.4}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="min-w-12 text-center text-xs text-white">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white"
          onClick={zoomIn}
          disabled={scale >= 3}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white"
          onClick={rotate}
        >
          <RotateCw className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-2 md:p-4">
        <div className="flex min-h-full flex-col items-center">
          <Document
            file={url}
            onLoadSuccess={onLoadSuccess}
            loading={
              <div className="flex items-center justify-center p-8">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-white" />
              </div>
            }
            error={
              <div className="p-8 text-center text-white/70">
                Failed to load PDF.
              </div>
            }
          >
            <Page
              pageNumber={pageNumber}
              scale={scale}
              rotate={rotation}
              className="mb-4 max-w-full shadow-lg"
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
          </Document>
        </div>
      </div>

      {numPages > 0 && (
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 safe-bottom">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-white"
            onClick={prevPage}
            disabled={pageNumber <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <span className="text-xs text-white">
            Page {pageNumber} of {numPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-white"
            onClick={nextPage}
            disabled={pageNumber >= numPages}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </motion.div>
  );
}
