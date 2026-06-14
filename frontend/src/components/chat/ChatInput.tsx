import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { 
  Send,
  Upload,
  ChevronRight,
  FileText,
  X,
  FolderOpen
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface ChatInputProps {
  onSendMessage: (content: string) => void;
  onFileUpload?: (files: File[]) => void;
  isLoading: boolean;
  selectedMode: 'pdf' | 'web';
  selectedFiles?: Set<string>;
  placeholder?: string;
  onOpenMobileSources?: () => void;
  onOpenSources?: () => void;
  attachedFilesCount?: number;
  uploadedFilesCount?: number;
}

const ChatInput = ({
  onSendMessage,
  onFileUpload,
  isLoading,
  selectedMode,
  selectedFiles = new Set(),
  placeholder = "Start typing...",
  onOpenMobileSources,
  onOpenSources,
  attachedFilesCount = 0,
  uploadedFilesCount = 0
}: ChatInputProps) => {
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  const handleSend = () => {
    if (!inputValue.trim() && attachments.length === 0) return;
    
    onSendMessage(inputValue);
    setInputValue('');
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const pdfFiles = files.filter(file => file.type === 'application/pdf');
    
    if (pdfFiles.length > 0) {
      if (onFileUpload) {
        onFileUpload(pdfFiles);
      } else {
        setAttachments(prev => [...prev, ...pdfFiles]);
      }
    }
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const selectedFilesCount = selectedFiles.size;
  const totalFilesCount = attachedFilesCount + uploadedFilesCount;

  return (
    <div className="border-t bg-gradient-to-r from-background via-muted/20 to-background p-4">


      {/* Selected Files Tab - Shows on both mobile and desktop */}
      {selectedMode === 'pdf' && (
        <div className="mb-3">
          <Button
            variant="outline"
            size="sm"
            onClick={isMobile ? onOpenMobileSources : onOpenSources}
            className="w-full justify-start gap-2 text-sm border-dashed border-academic-burgundy/30 text-academic-burgundy hover:bg-academic-burgundy/10 hover:border-academic-burgundy/50 transition-all duration-200"
          >
            <FileText className="w-4 h-4" />
            <span className="flex-1 text-left">
              {selectedFilesCount > 0 
                ? `${selectedFilesCount} file${selectedFilesCount === 1 ? '' : 's'} selected`
                : 'No files selected'
              }
            </span>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Input Area */}
      <div className="flex gap-3 items-end">
        <div className="flex-1 relative">
          <Textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="min-h-[56px] resize-none border-2 border-border/50 focus:border-academic-teal/50 rounded-xl bg-background/80 backdrop-blur-sm shadow-sm transition-all duration-200 placeholder:text-muted-foreground/70 pr-12 scrollbar-hide"
            disabled={isLoading}
            rows={1}
          />
          
          {/* File upload button for PDF mode */}
          {selectedMode === 'pdf' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 hover:bg-academic-teal/10 text-muted-foreground hover:text-academic-teal transition-colors rounded-lg"
            >
              <Upload className="w-4 h-4" />
            </Button>
          )}
        </div>
        
        <Button
          onClick={handleSend}
          disabled={(!inputValue.trim() && attachments.length === 0) || isLoading}
          className="h-12 w-12 rounded-xl bg-gradient-to-r from-academic-teal to-academic-burgundy hover:from-academic-teal/90 hover:to-academic-burgundy/90 shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          size="icon"
        >
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Send className="w-5 h-5 text-white" />
          )}
        </Button>
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {attachments.map((file, index) => (
            <Badge
              key={index}
              variant="secondary"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
            >
              <FileText className="w-3 h-3" />
              <span className="text-xs font-medium">{file.name}</span>
              <button
                onClick={() => removeAttachment(index)}
                className="hover:bg-background/50 rounded-full p-1 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
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
    </div>
  );
};

export default ChatInput;
