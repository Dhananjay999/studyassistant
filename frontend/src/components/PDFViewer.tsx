import { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  ChevronLeft, 
  ChevronRight,
  X,
  Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Set up the worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  file: File | null;
  isVisible: boolean;
  onToggleVisibility: () => void;
  className?: string;
}

export const PDFViewer = ({ file, isVisible, onToggleVisibility, className }: PDFViewerProps) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(0.5); // Start at 50% zoom
  const [rotation, setRotation] = useState<number>(0);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  }, []);

  const goToPrevPage = () => setPageNumber(page => Math.max(1, page - 1));
  const goToNextPage = () => setPageNumber(page => Math.min(numPages, page + 1));
  const zoomIn = () => setScale(scale => Math.min(3.0, scale + 0.2));
  const zoomOut = () => setScale(scale => Math.max(0.25, scale - 0.2));
  const rotate = () => setRotation(rotation => (rotation + 90) % 360);

  if (!isVisible) {
    return (
      <div className={cn("flex items-center justify-center p-4", className)}>
        <Button
          variant="academicOutline"
          onClick={onToggleVisibility}
          className="flex items-center gap-2"
        >
          <Eye className="w-4 h-4" />
          Show PDF Viewer
        </Button>
      </div>
    );
  }

  return (
    <Card className={cn("h-full flex flex-col overflow-hidden", className)}>
      {/* Header with controls */}
      <div className="border-b p-2 md:p-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs md:text-sm font-medium">PDF Viewer</span>
            {file && (
              <span className="text-xs text-muted-foreground truncate max-w-24 md:max-w-32">
                {file.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={zoomOut}
              disabled={scale <= 0.25}
              className="h-7 w-7 md:h-8 md:w-8"
            >
              <ZoomOut className="w-3 h-3 md:w-4 md:h-4" />
            </Button>
            <span className="text-xs px-1 md:px-2 min-w-12 md:min-w-16 text-center">
              {Math.round(scale * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={zoomIn}
              disabled={scale >= 3.0}
              className="h-7 w-7 md:h-8 md:w-8"
            >
              <ZoomIn className="w-3 h-3 md:w-4 md:h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={rotate}
              className="h-7 w-7 md:h-8 md:w-8"
            >
              <RotateCw className="w-3 h-3 md:w-4 md:h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleVisibility}
              className="h-7 w-7 md:h-8 md:w-8"
            >
              <X className="w-3 h-3 md:w-4 md:h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* PDF Content */}
      <div className="flex-1 overflow-auto bg-gray-50 p-2 md:p-4">
        {file ? (
          <div className="flex flex-col items-center min-h-full">
            <Document
              file={file}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <div className="flex items-center justify-center p-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-academic-teal"></div>
                </div>
              }
              error={
                <div className="text-center p-8 text-muted-foreground">
                  <p>Failed to load PDF. Please try again.</p>
                </div>
              }
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                rotate={rotation}
                loading={
                  <div className="flex items-center justify-center p-4">
                    <div className="animate-pulse bg-gray-200 w-80 h-96 rounded"></div>
                  </div>
                }
                className="shadow-lg mb-2 md:mb-4 max-w-full"
                width={undefined}
                height={undefined}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            </Document>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>No PDF selected. Upload a PDF to view it here.</p>
          </div>
        )}
      </div>

      {/* Footer with navigation */}
      {file && numPages > 0 && (
        <div className="border-t p-2 md:p-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={goToPrevPage}
              disabled={pageNumber <= 1}
              className="flex items-center gap-1 text-xs md:text-sm"
            >
              <ChevronLeft className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Previous</span>
            </Button>
            <span className="text-xs md:text-sm">
              Page {pageNumber} of {numPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={goToNextPage}
              disabled={pageNumber >= numPages}
              className="flex items-center gap-1 text-xs md:text-sm"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="w-3 h-3 md:w-4 md:h-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};