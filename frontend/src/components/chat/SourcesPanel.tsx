import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { 
  Plus, 
  Search, 
  FileText, 
  X, 
  Check,
  ChevronRight,
  Upload,
  Eye,
  Trash2,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatMode } from "@/types";
import { useIsMobile } from "@/hooks/use-mobile";

interface SourcesPanelProps {
  selectedMode: 'pdf' | 'web';
  onModeChange: (mode: 'pdf' | 'web') => void;
  attachedFiles: File[];
  uploadedFileNames: string[];
  uploadingFiles: { file: File; progress: number }[];
  currentPDF: File | null;
  selectedFiles: Set<string>;
  onFileUpload: (files: File[]) => void;
  onFileDelete: (fileName: string) => void;
  onPDFSelect: (file: File | null) => void;
  onPDFViewerToggle: (show: boolean) => void;
  onFileSelection: (fileName: string, isSelected: boolean) => void;
  onSelectAll: (isSelected: boolean) => void;
  showPDFViewer: boolean;
  chatModes: ChatMode[];
  isAllSelected: boolean;
  isSomeSelected: boolean;
  isMobile?: boolean;
}

const SourcesPanel = ({
  selectedMode,
  onModeChange,
  attachedFiles,
  uploadedFileNames,
  uploadingFiles,
  currentPDF,
  selectedFiles,
  onFileUpload,
  onFileDelete,
  onPDFSelect,
  onPDFViewerToggle,
  onFileSelection,
  onSelectAll,
  showPDFViewer,
  chatModes,
  isAllSelected,
  isSomeSelected,
  isMobile = false
}: SourcesPanelProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileIsMobile = useIsMobile();
  const isMobileView = isMobile || mobileIsMobile;

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
    onPDFViewerToggle(true);
  };

  const handleDeleteFile = (fileName: string) => {
    onFileDelete(fileName);
  };

  const handleCheckboxChange = (fileName: string, checked: boolean) => {
    onFileSelection(fileName, checked);
  };

  const handleSelectAllChange = (checked: boolean) => {
    onSelectAll(checked);
  };

  const allFiles = [...attachedFiles, ...uploadedFileNames.map(name => ({ name } as File))];

  if (isMobileView) {
    return (
      <div className="h-full flex flex-col">
        {/* Mobile Header */}
        <div className="p-4 border-b bg-card/50">
          <h2 className="font-semibold text-lg mb-4">Sources</h2>
          
          {/* Action Buttons */}
          <div className="flex gap-3 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 gap-2 h-10"
            >
              <Plus className="w-4 h-4" />
              Add PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-2 h-10"
            >
              <Search className="w-4 h-4" />
              Discover
            </Button>
          </div>

          {/* Select All Checkbox */}
          {allFiles.length > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-muted/30 rounded-lg">
              <input
                type="checkbox"
                id="select-all-mobile"
                checked={isAllSelected}
                onChange={(e) => handleSelectAllChange(e.target.checked)}
                className="w-5 h-5 text-academic-teal bg-background border-academic-teal/30 rounded focus:ring-academic-teal/50 focus:ring-2"
              />
              <label htmlFor="select-all-mobile" className="text-sm text-muted-foreground cursor-pointer flex-1">
                Select all sources
              </label>
              {isSomeSelected && !isAllSelected && (
                <Badge variant="secondary" className="text-xs">
                  {selectedFiles.size} selected
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Mobile File List */}
        <div className="flex-1 overflow-y-auto p-4">
          {allFiles.length === 0 && uploadingFiles.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-muted-foreground/50" />
              </div>
              <p className="text-base font-medium text-muted-foreground mb-2">No sources added yet</p>
              <p className="text-sm text-muted-foreground/70">Upload PDFs or search the web to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Currently Uploading Files */}
              {uploadingFiles.map((uploadingFile, index) => (
                <Card
                  key={`mobile-uploading-${index}`}
                  className="p-4 border-2 border-dashed border-academic-teal/30 bg-academic-teal/5"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-academic-teal/10 flex items-center justify-center flex-shrink-0">
                        <Loader2 className="w-5 h-5 text-academic-teal animate-spin" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{uploadingFile.file.name}</p>
                        <p className="text-xs text-muted-foreground">Uploading...</p>
                      </div>
                    </div>
                    <span className="text-sm text-academic-teal font-medium">
                      {uploadingFile.progress}%
                    </span>
                  </div>
                  <Progress 
                    value={uploadingFile.progress} 
                    className="h-2"
                  />
                </Card>
              ))}

              {/* Successfully Uploaded Files */}
              {attachedFiles.map((file, index) => {
                const isUploading = uploadingFiles.some(uf => uf.file === file);
                if (isUploading) return null; // Skip if still uploading
                
                const isSelected = selectedFiles.has(file.name);
                
                return (
                  <Card
                    key={`mobile-attached-${index}`}
                    className={cn(
                      "p-4 cursor-pointer transition-all duration-200 hover:bg-muted/50",
                      currentPDF?.name === file.name && showPDFViewer && "ring-2 ring-academic-teal/50 bg-academic-teal/10",
                      isSelected && "ring-2 ring-academic-teal/30 bg-academic-teal/5"
                    )}
                    onClick={() => handleFileClick(file)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleCheckboxChange(file.name, e.target.checked);
                          }}
                          className="w-5 h-5 text-academic-teal bg-background border-academic-teal/30 rounded focus:ring-academic-teal/50 focus:ring-2 flex-shrink-0"
                        />
                        <div className="w-10 h-10 rounded-lg bg-academic-teal/10 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-5 h-5 text-academic-teal" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground">PDF Document</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFile(file.name);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  </Card>
                );
              })}
              
              {/* Previously Uploaded Files */}
              {uploadedFileNames.map((fileName, index) => {
                const isSelected = selectedFiles.has(fileName);
                
                return (
                  <Card
                    key={`mobile-uploaded-${index}`}
                    className={cn(
                      "p-4 cursor-pointer transition-all duration-200 hover:bg-muted/50 border-dashed border-academic-burgundy/30",
                      isSelected && "ring-2 ring-academic-burgundy/30 bg-academic-burgundy/5"
                    )}
                    onClick={() => {
                      // Handle uploaded file click - could show info or re-upload
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleCheckboxChange(fileName, e.target.checked);
                          }}
                          className="w-5 h-5 text-academic-burgundy bg-background border-academic-burgundy/30 rounded focus:ring-academic-burgundy/50 focus:ring-2 flex-shrink-0"
                        />
                        <div className="w-10 h-10 rounded-lg bg-academic-burgundy/10 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-5 h-5 text-academic-burgundy" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{fileName}</p>
                          <p className="text-xs text-muted-foreground">Previous Session</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFile(fileName);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    );
  }

  // Desktop version (original)
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg mb-3">Sources</h2>
        
        {/* Action Buttons */}
        <div className="flex gap-2 mb-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
          >
            <Search className="w-4 h-4 mr-2" />
            Discover
          </Button>
        </div>

        {/* Select All Checkbox */}
        {allFiles.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <input
              type="checkbox"
              id="select-all"
              checked={isAllSelected}
              onChange={(e) => handleSelectAllChange(e.target.checked)}
              className="w-4 h-4 text-academic-teal bg-background border-academic-teal/30 rounded focus:ring-academic-teal/50 focus:ring-2"
            />
            <label htmlFor="select-all" className="text-sm text-muted-foreground cursor-pointer">
              Select all sources
            </label>
            {isSomeSelected && !isAllSelected && (
              <span className="text-xs text-academic-teal ml-2">
                ({selectedFiles.size} selected)
              </span>
            )}
          </div>
        )}
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto p-4">
        {allFiles.length === 0 && uploadingFiles.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-2">No sources added</p>
            <p className="text-xs text-muted-foreground/70">Upload PDFs or search the web to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Currently Uploading Files */}
            {uploadingFiles.map((uploadingFile, index) => (
              <Card
                key={`uploading-${index}`}
                className="p-3 border-2 border-dashed border-academic-teal/30 bg-academic-teal/5"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-academic-teal/10 flex items-center justify-center flex-shrink-0">
                      <Loader2 className="w-4 h-4 text-academic-teal animate-spin" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{uploadingFile.file.name}</p>
                      <p className="text-xs text-muted-foreground">Uploading...</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-academic-teal font-medium">
                      {uploadingFile.progress}%
                    </span>
                  </div>
                </div>
                <Progress 
                  value={uploadingFile.progress} 
                  className="h-1"
                />
              </Card>
            ))}

            {/* Successfully Uploaded Files */}
            {attachedFiles.map((file, index) => {
              const isUploading = uploadingFiles.some(uf => uf.file === file);
              if (isUploading) return null; // Skip if still uploading
              
              const isSelected = selectedFiles.has(file.name);
              
              return (
                <Card
                  key={`attached-${index}`}
                  className={cn(
                    "p-3 cursor-pointer transition-all duration-200 hover:bg-muted/50",
                    currentPDF?.name === file.name && showPDFViewer && "ring-2 ring-academic-teal/50 bg-academic-teal/10",
                    isSelected && "ring-2 ring-academic-teal/30 bg-academic-teal/5"
                  )}
                  onClick={() => handleFileClick(file)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleCheckboxChange(file.name, e.target.checked);
                        }}
                        className="w-4 h-4 text-academic-teal bg-background border-academic-teal/30 rounded focus:ring-academic-teal/50 focus:ring-2 flex-shrink-0"
                      />
                      <div className="w-8 h-8 rounded-lg bg-academic-teal/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-academic-teal" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">PDF Document</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFile(file.name);
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </Card>
              );
            })}
            
            {/* Previously Uploaded Files */}
            {uploadedFileNames.map((fileName, index) => {
              const isSelected = selectedFiles.has(fileName);
              
              return (
                <Card
                  key={`uploaded-${index}`}
                  className={cn(
                    "p-3 cursor-pointer transition-all duration-200 hover:bg-muted/50 border-dashed border-academic-burgundy/30",
                    isSelected && "ring-2 ring-academic-burgundy/30 bg-academic-burgundy/5"
                  )}
                  onClick={() => {
                    // Handle uploaded file click - could show info or re-upload
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleCheckboxChange(fileName, e.target.checked);
                        }}
                        className="w-4 h-4 text-academic-burgundy bg-background border-academic-burgundy/30 rounded focus:ring-academic-burgundy/50 focus:ring-2 flex-shrink-0"
                      />
                      <div className="w-8 h-8 rounded-lg bg-academic-burgundy/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-academic-burgundy" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{fileName}</p>
                        <p className="text-xs text-muted-foreground">Previous Session</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFile(fileName);
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    );
  };

export default SourcesPanel;
