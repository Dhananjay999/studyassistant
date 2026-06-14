import { Button } from "@/components/ui/button";
import { 
  FileText,
  X
} from "lucide-react";
import { PDFViewer } from "@/components/PDFViewer";

interface PDFSectionProps {
  currentPDF: File | null;
  showPDFViewer: boolean;
  onPDFViewerToggle: (show: boolean) => void;
}

const PDFSection = ({
  currentPDF,
  showPDFViewer,
  onPDFViewerToggle
}: PDFSectionProps) => {
  if (!showPDFViewer || !currentPDF) {
    return null;
  }

  return (
    <div className="h-full flex flex-col">
      {/* PDF Viewer Header */}
      <div className="flex items-center justify-between p-3 border-b bg-card/30">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-academic-teal" />
          <span className="font-medium text-sm truncate">{currentPDF.name}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onPDFViewerToggle(false)}
          className="h-6 w-6"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
      
      {/* PDF Viewer Content */}
      <div className="flex-1 overflow-hidden">
        <PDFViewer
          file={currentPDF}
          isVisible={true}
          onToggleVisibility={() => onPDFViewerToggle(false)}
          className="h-full"
        />
      </div>
    </div>
  );
};

export default PDFSection;
