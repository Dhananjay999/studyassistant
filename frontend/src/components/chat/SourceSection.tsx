import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { 
  FileText, 
  X, 
  ChevronDown,
  Upload,
  Eye,
  Trash2,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PDFViewer } from "@/components/PDFViewer";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";

interface SourceSectionProps {
  selectedMode: 'pdf' | 'web';
  attachedFiles: File[];
  uploadedFileNames: string[];
  uploadingFiles: { file: File; progress: number }[];
  currentPDF: File | null;
  showPDFViewer: boolean;
  showMobilePDF: boolean;
  isFilePanelExpanded: boolean;
  onFileUpload: (files: File[]) => void;
  onFileDelete: (index: number) => void;
  onUploadedFileDelete: (fileName: string) => void;
  onPDFSelect: (file: File | null) => void;
  onPDFViewerToggle: (show: boolean) => void;
  onMobilePDFToggle: (show: boolean) => void;
  onFilePanelToggle: (expanded: boolean) => void;
  onUploadedFileNameClick: (fileName: string) => void;
}

const SourceSection = ({
  selectedMode,
  attachedFiles,
  uploadedFileNames,
  uploadingFiles,
  currentPDF,
  showPDFViewer,
  showMobilePDF,
  isFilePanelExpanded,
  onFileUpload,
  onFileDelete,
  onUploadedFileDelete,
  onPDFSelect,
  onPDFViewerToggle,
  onMobilePDFToggle,
  onFilePanelToggle,
  onUploadedFileNameClick
}: SourceSectionProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const pdfFiles = files.filter(file => file.type === 'application/pdf');
    
    if (pdfFiles.length > 0) {
      onFileUpload(pdfFiles);
    }
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileClick = (file: File) => {
    onPDFSelect(file);
    if (isMobile) {
      onMobilePDFToggle(true);
    } else {
      onPDFViewerToggle(true);
    }
  };

  // Only show source section for PDF mode
  if (selectedMode !== 'pdf') {
    return null;
  }

  return (
    <>
      {/* File attachments preview */}
      {(attachedFiles.length > 0 || uploadedFileNames.length > 0) && (
        <div className="border-t bg-muted/30">
          <div className="px-3 md:px-4 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Uploaded Files</span>
              <button
                onClick={() => {
                  if (isMobile) {
                    // Handle mobile file sheet
                  } else {
                    onFilePanelToggle(!isFilePanelExpanded);
                  }
                }}
                className="text-xs text-academic-teal hover:text-academic-teal/80 transition-colors flex items-center gap-1"
              >
                {isFilePanelExpanded ? 'Collapse' : 'Expand'}
                <ChevronDown className={cn("w-3 h-3 transition-transform", isFilePanelExpanded && "rotate-180")} />
              </button>
            </div>
            <div className={cn(
              "flex flex-wrap gap-2 transition-all duration-300",
              isFilePanelExpanded ? "max-h-32 overflow-y-auto mt-2" : "max-h-0 overflow-hidden"
            )}>
              {/* Currently uploading files */}
              {uploadingFiles.map((uploadingFile, index) => (
                <Badge 
                  key={`uploading-${index}`} 
                  variant="outline" 
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border-dashed border-academic-teal/30 bg-academic-teal/5"
                >
                  <div className="w-3 h-3 border-2 border-academic-teal border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-medium">{uploadingFile.file.name}</span>
                  <span className="text-xs text-academic-teal">{uploadingFile.progress}%</span>
                </Badge>
              ))}
              
              {/* Currently attached files (with preview) */}
              {attachedFiles.map((file, index) => {
                const isUploading = uploadingFiles.some(uf => uf.file === file);
                if (isUploading) return null; // Skip if still uploading
                
                return (
                  <Badge 
                    key={`attached-${index}`} 
                    variant="secondary" 
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200 cursor-pointer flex-shrink-0",
                      currentPDF?.name === file.name && (showPDFViewer || showMobilePDF) && "bg-academic-teal text-white hover:bg-academic-teal/90 shadow-md"
                    )}
                    onClick={() => handleFileClick(file)}
                  >
                    <FileText className="w-3 h-3" />
                    <span className="text-xs font-medium">{file.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onFileDelete(index);
                      }}
                      className="hover:bg-background/50 rounded-full p-1 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                );
              })}
              
              {/* Previously uploaded files (no preview) */}
              {uploadedFileNames.map((fileName, index) => (
                <Badge 
                  key={`uploaded-${index}`} 
                  variant="outline" 
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200 cursor-pointer border-dashed border-academic-burgundy/30 text-academic-burgundy/70 hover:border-academic-burgundy/50 hover:text-academic-burgundy flex-shrink-0"
                  onClick={() => onUploadedFileNameClick(fileName)}
                >
                  <FileText className="w-3 h-3" />
                  <span className="text-xs font-medium">{fileName}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUploadedFileDelete(fileName);
                    }}
                    className="hover:bg-background/50 rounded-full p-1 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Mobile PDF Drawer */}
      <Drawer open={showMobilePDF} onOpenChange={onMobilePDFToggle}>
        <DrawerContent className="h-[80vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              {currentPDF?.name}
            </DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 overflow-hidden">
            <PDFViewer
              file={currentPDF}
              isVisible={showMobilePDF}
              onToggleVisibility={() => onMobilePDFToggle(false)}
              className="h-full"
            />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
};

export default SourceSection;
