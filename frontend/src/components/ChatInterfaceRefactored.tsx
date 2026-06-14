import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { 
  Send, 
  Upload, 
  FileText, 
  Globe, 
  Paperclip, 
  X,
  Bot,
  User,
  Info,
  Expand,
  Minimize,
  Brain,
  ChevronDown,
  RefreshCw,
  Maximize2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SEARCH_MODES } from "@/constants";
import { apiService } from "@/services";
import { 
  Message, 
  ChatMode
} from "@/types";
import { 
  createMessageId, 
  mapAPIMetadataToSourceInfo,
  isValidMessage,
  isValidFile 
} from "@/utils";
import { useToast } from "@/hooks/use-toast";
import NewSessionDialog from "@/components/NewSessionDialog";
import { useAuth } from "@/contexts/AuthContext";
import AuthModal from "./AuthModal";

// Import refactored components
import ChatHeader from "./chat/ChatHeader";
import ChatMessages from "./chat/ChatMessages";
import ChatInput from "./chat/ChatInput";
import SourceSection from "./chat/SourceSection";
import PDFSection from "./chat/PDFSection";

const ChatInterfaceRefactored = () => {
  const navigate = useNavigate();
  // Separate chat histories for each mode
  const [pdfMessages, setPdfMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'bot',
      content: 'Hello! I\'m your AI study assistant. Upload your PDFs and ask me questions about your documents. How can I help you study today?',
      timestamp: new Date(),
    }
  ]);
  
  const [webMessages, setWebMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'bot',
      content: 'Hello! I\'m your AI study assistant. I can search the web for academic information and research. What would you like to learn about today?',
      timestamp: new Date(),
    }
  ]);

  const [inputValue, setInputValue] = useState('');
  const [selectedMode, setSelectedMode] = useState<'pdf' | 'web'>('pdf');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [webLoading, setWebLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [pdfMetadata, setPdfMetadata] = useState<Record<string, boolean>>({});
  const [webMetadata, setWebMetadata] = useState<Record<string, boolean>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPDFViewer, setShowPDFViewer] = useState(false);
  const [currentPDF, setCurrentPDF] = useState<File | null>(null);
  const [showMobilePDF, setShowMobilePDF] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<number | null>(null);
  const [rememberDeleteDecision, setRememberDeleteDecision] = useState(false);
  const [skipDeleteConfirmation, setSkipDeleteConfirmation] = useState(false);
  const [uploadedFileNames, setUploadedFileNames] = useState<string[]>([]);
  const [isLoadingUploadedFiles, setIsLoadingUploadedFiles] = useState(false);
  const [isFilePanelExpanded, setIsFilePanelExpanded] = useState(false);
  const [showPreviewNotAvailable, setShowPreviewNotAvailable] = useState(false);
  const [previewNotAvailableFileName, setPreviewNotAvailableFileName] = useState('');
  const [showMobileFileSheet, setShowMobileFileSheet] = useState(false);
  const [showNewSessionConfirmation, setShowNewSessionConfirmation] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<{ file: File; progress: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { isAuthenticated, user } = useAuth();

  // Prevent body scroll when fullscreen
  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isFullscreen]);

  // Get current mode's data
  const currentMessages = selectedMode === 'pdf' ? pdfMessages : webMessages;
  const setCurrentMessages = selectedMode === 'pdf' ? setPdfMessages : setWebMessages;
  const isLoading = selectedMode === 'pdf' ? pdfLoading : webLoading;
  const setIsLoading = selectedMode === 'pdf' ? setPdfLoading : setWebLoading;
  const showMetadata = selectedMode === 'pdf' ? pdfMetadata : webMetadata;
  const setShowMetadata = selectedMode === 'pdf' ? setPdfMetadata : setWebMetadata;

  // Fetch uploaded files on component mount
  useEffect(() => {
    const fetchUploadedFiles = async () => {
      if (selectedMode === 'pdf') {
        setIsLoadingUploadedFiles(true);
        try {
          const response = await apiService.getUploadedFiles();
          setUploadedFileNames(response.file_names);
        } catch (error) {
          console.error('Failed to fetch uploaded files:', error);
        } finally {
          setIsLoadingUploadedFiles(false);
        }
      }
    };

    fetchUploadedFiles();
  }, [selectedMode]);

  // Scroll to bottom when messages change
  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages]);

  const chatModes: ChatMode[] = [
    {
      id: 'pdf',
      label: 'From PDF',
      icon: FileText,
      description: 'Ask questions about your uploaded documents',
      searchMode: 'study_material'
    },
    {
      id: 'web',
      label: 'Web Results',
      icon: Globe,
      description: 'Search the web for academic information',
      searchMode: 'web_search'
    }
  ];

  const handleSendMessage = async () => {
    if (!isValidMessage(inputValue) && attachedFiles.length === 0) return;

    const newMessage: Message = {
      id: createMessageId(),
      type: 'user',
      content: inputValue,
      timestamp: new Date(),
      attachments: attachedFiles.length > 0 ? [...attachedFiles] : undefined
    };

    setCurrentMessages(prev => [...prev, newMessage]);
    setInputValue('');
    setAttachedFiles([]);
    setIsLoading(true);

    try {
      const searchMode = chatModes.find(mode => mode.id === selectedMode)?.searchMode || SEARCH_MODES.STUDY_MATERIAL;
      const data = await apiService.sendChatMessage(inputValue, searchMode);
      
      // Check if the response contains raw PDF text content and handle it appropriately
      let processedContent = data.answer;
      
      // If this is a PDF-related response and the content seems like raw extracted text,
      // provide a more user-friendly response
      if (selectedMode === 'pdf' && data.metadata.some(meta => meta.source === 'uploaded_pdf')) {
        // Check if the content looks like raw PDF text (very long, unformatted)
        if (data.answer.length > 1000 && !data.answer.includes('\n\n')) {
          processedContent = `I've analyzed your PDF document. The content appears to be ${data.answer.length} characters long. 

**Please ask specific questions about the PDF content**, such as:
- "What is the main topic of this document?"
- "Summarize the key points"
- "What are the main conclusions?"
- "Explain the methodology used"

I can help you understand and work with the content more effectively when you ask targeted questions.`;
        }
      }
      
      const botResponse: Message = {
        id: createMessageId(),
        type: 'bot',
        content: processedContent,
        timestamp: new Date(),
        metadata: {
          sources: data.metadata.map(mapAPIMetadataToSourceInfo)
        }
      };

      setCurrentMessages(prev => [...prev, botResponse]);
    } catch (error) {
      console.error('Error calling API:', error);
      
      const errorResponse: Message = {
        id: createMessageId(),
        type: 'bot',
        content: 'Sorry, I encountered an error while processing your request. Please try again.',
        timestamp: new Date()
      };
      
      setCurrentMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (files: File[]) => {
    console.log('Selected files:', files.map(f => ({ name: f.name, type: f.type, size: f.size })));
    
    const validPdfFiles = files.filter(isValidFile);
    console.log('Valid PDF files:', validPdfFiles.map(f => ({ name: f.name, type: f.type, size: f.size })));
    
    if (validPdfFiles.length === 0) {
      console.log('No valid PDF files found');
      return;
    }

    // Immediately add files to the uploading list with progress
    const newUploadingFiles = validPdfFiles.map(file => ({ file, progress: 0 }));
    setUploadingFiles(prev => [...prev, ...newUploadingFiles]);
    
    // Also add to attached files immediately for display
    setAttachedFiles(prev => [...prev, ...validPdfFiles]);

    setUploadLoading(true);
    
    try {
      console.log('Starting file upload for:', validPdfFiles.length, 'files');
      
      // Start the actual upload first
      const uploadPromise = apiService.uploadFiles(validPdfFiles);
      
      // Simulate progress over 4-5 seconds while upload is happening
      const progressPromises = validPdfFiles.map(async (file) => {
        const totalSteps = 20; // More granular steps for smoother progress
        const stepDelay = 250; // 250ms per step = 5 seconds total
        
        for (let step = 0; step <= totalSteps; step++) {
          const progress = Math.round((step / totalSteps) * 100);
          
          // Don't go to 100% until upload is actually complete
          if (step === totalSteps) {
            // Wait for the actual upload to complete
            await uploadPromise;
            // Now we can set to 100%
            setUploadingFiles(prev => 
              prev.map((uf) => 
                uf.file === file ? { ...uf, progress: 100 } : uf
              )
            );
          } else {
            setUploadingFiles(prev => 
              prev.map((uf) => 
                uf.file === file ? { ...uf, progress } : uf
              )
            );
            await new Promise(resolve => setTimeout(resolve, stepDelay));
          }
        }
        
        return file;
      });

      // Wait for all progress animations and upload to complete
      await Promise.all(progressPromises);
      console.log('File upload completed successfully');
      
      // Remove from uploading list
      setUploadingFiles(prev => prev.filter(uf => !validPdfFiles.includes(uf.file)));
      
      // Set the first PDF as the current PDF for viewing
      if (!currentPDF) {
        setCurrentPDF(validPdfFiles[0]);
        if (isMobile) {
          setShowMobilePDF(true);
        } else {
          setShowPDFViewer(true);
        }
      }
      
      // Add success message
      const uploadMessage: Message = {
        id: createMessageId(),
        type: 'bot',
        content: `Successfully uploaded ${validPdfFiles.length} PDF file(s). You can now ask questions about your documents.`,
        timestamp: new Date()
      };
      
      setCurrentMessages(prev => [...prev, uploadMessage]);
      
    } catch (error) {
      console.error('File upload failed:', error);
      
      // Remove from uploading list and attached files on error
      setUploadingFiles(prev => prev.filter(uf => !validPdfFiles.includes(uf.file)));
      setAttachedFiles(prev => prev.filter(file => !validPdfFiles.includes(file)));
      
      // Add error message
      const errorMessage: Message = {
        id: createMessageId(),
        type: 'bot',
        content: 'Failed to upload PDF file(s). Please try again.',
        timestamp: new Date()
      };
      
      setCurrentMessages(prev => [...prev, errorMessage]);
    } finally {
      setUploadLoading(false);
    }
  };

  const removeFile = async (index: number) => {
    const fileToDelete = attachedFiles[index];
    if (!fileToDelete) return;

    try {
      // Call API to delete file from server
      const response = await apiService.deleteFile(fileToDelete.name);
      
      // Remove from local state
      setAttachedFiles(prev => {
        const newFiles = prev.filter((_, i) => i !== index);
        
        // If the deleted file is the current PDF, close the viewer and clear current PDF
        if (currentPDF && prev[index] && currentPDF.name === prev[index].name) {
          setCurrentPDF(null);
          setShowPDFViewer(false);
          setShowMobilePDF(false);
        }
        
        return newFiles;
      });

      // Show success toast
      toast({
        title: "File Deleted Successfully",
        description: response.message,
        className: "bg-gradient-to-r from-academic-teal/10 to-academic-burgundy/10 border-2 border-academic-teal/30 text-academic-teal shadow-lg",
        action: (
          <div className="w-2 h-2 bg-academic-teal rounded-full animate-pulse"></div>
        ),
        duration: 2000, // Auto-close after 2 seconds
      });
    } catch (error) {
      console.error('Failed to delete file:', error);
      
      // Show error toast
      toast({
        title: "Delete Failed",
        description: "Failed to delete file. Please try again.",
        className: "bg-gradient-to-r from-academic-burgundy/10 to-academic-rose/10 border-2 border-academic-burgundy/30 text-academic-burgundy shadow-lg",
        action: (
          <div className="w-2 h-2 bg-academic-burgundy rounded-full animate-pulse"></div>
        ),
        duration: 2000, // Auto-close after 2 seconds
      });
    }
  };

  const removeUploadedFileName = async (fileName: string) => {
    try {
      // Call API to delete file from server
      const response = await apiService.deleteFile(fileName);
      
      // Remove from local state
      setUploadedFileNames(prev => prev.filter(name => name !== fileName));

      // Show success toast
      toast({
        title: "File Deleted Successfully",
        description: response.message,
        className: "bg-gradient-to-r from-academic-teal/10 to-academic-burgundy/10 border-2 border-academic-teal/30 text-academic-teal shadow-lg",
        action: (
          <div className="w-2 h-2 bg-academic-teal rounded-full animate-pulse"></div>
        ),
        duration: 2000, // Auto-close after 2 seconds
      });
    } catch (error) {
      console.error('Failed to delete file:', error);
      
      // Show error toast
      toast({
        title: "Delete Failed",
        description: "Failed to delete file. Please try again.",
        className: "bg-gradient-to-r from-academic-burgundy/10 to-academic-rose/10 border-2 border-academic-burgundy/30 text-academic-burgundy shadow-lg",
        action: (
          <div className="w-2 h-2 bg-academic-burgundy rounded-full animate-pulse"></div>
        ),
        duration: 2000, // Auto-close after 2 seconds
      });
    }
  };

  const handleDeleteFile = async (index: number) => {
    if (skipDeleteConfirmation) {
      // Direct delete if user chose to remember their decision
      await removeFile(index);
    } else {
      setFileToDelete(index);
      setShowDeleteConfirmation(true);
    }
  };

  const confirmDeleteFile = async () => {
    try {
      if (fileToDelete !== null) {
        await removeFile(fileToDelete);
        setFileToDelete(null);
      } else if (previewNotAvailableFileName) {
        // Check if this is an uploaded file name (not an attached file)
        const isUploadedFileName = uploadedFileNames.includes(previewNotAvailableFileName);
        if (isUploadedFileName) {
          await removeUploadedFileName(previewNotAvailableFileName);
        }
      }
      
      // If user checked "remember my decision", skip future confirmations
      if (rememberDeleteDecision) {
        setSkipDeleteConfirmation(true);
      }
    } catch (error) {
      // Error is already handled in removeFile/removeUploadedFileName functions
      console.error('Error in confirmDeleteFile:', error);
    } finally {
      setShowDeleteConfirmation(false);
      setRememberDeleteDecision(false); // Reset checkbox for next time
      setPreviewNotAvailableFileName(''); // Reset file name
    }
  };

  const cancelDeleteFile = () => {
    setFileToDelete(null);
    setShowDeleteConfirmation(false);
    setRememberDeleteDecision(false); // Reset checkbox
    setPreviewNotAvailableFileName(''); // Reset file name
  };

  const handleUploadedFileNameClick = (fileName: string) => {
    setPreviewNotAvailableFileName(fileName);
    setShowPreviewNotAvailable(true);
  };

  const handleStartNewSession = () => {
    console.log('handleStartNewSession', isAuthenticated);
    if (isAuthenticated) {
      confirmNewSession();
    } else {
      setShowNewSessionConfirmation(true);
    }
  };

  const confirmNewSession = async () => {
    try {
      if (selectedMode === 'pdf') {
        // Delete all files from server
        const response = await apiService.deleteAllFiles();
        
        // Clear PDF-related data
        setPdfMessages([
          {
            id: '1',
            type: 'bot',
            content: 'Hello! I\'m your AI study assistant. Upload your PDFs and ask me questions about your documents. How can I help you study today?',
            timestamp: new Date(),
          }
        ]);
        setAttachedFiles([]);
        setUploadedFileNames([]);
        setCurrentPDF(null);
        setShowPDFViewer(false);
        setShowMobilePDF(false);
        setPdfMetadata({});

        // Show success toast
        toast({
          title: "New Session Started",
          description: `Successfully cleared PDF session. ${response.message}`,
          className: "bg-gradient-to-r from-academic-teal/10 to-academic-burgundy/10 border-2 border-academic-teal/30 text-academic-teal shadow-lg",
          action: (
            <div className="w-2 h-2 bg-academic-teal rounded-full animate-pulse"></div>
          ),
          duration: 2000,
        });
      } else {
        // Clear web search data only
        setWebMessages([
          {
            id: '1',
            type: 'bot',
            content: 'Hello! I\'m your AI study assistant. I can search the web for academic information and research. What would you like to learn about today?',
            timestamp: new Date(),
          }
        ]);
        setWebMetadata({});

        // Show success toast
        toast({
          title: "New Session Started",
          description: "Successfully cleared web search session.",
          className: "bg-gradient-to-r from-academic-teal/10 to-academic-burgundy/10 border-2 border-academic-teal/30 text-academic-teal shadow-lg",
          action: (
            <div className="w-2 h-2 bg-academic-teal rounded-full animate-pulse"></div>
          ),
          duration: 2000,
        });
      }
    } catch (error) {
      console.error('Failed to start new session:', error);
      
      // Show error toast
      toast({
        title: "Session Reset Failed",
        description: "Failed to start new session. Please try again.",
        className: "bg-gradient-to-r from-academic-burgundy/10 to-academic-rose/10 border-2 border-academic-burgundy/30 text-academic-burgundy shadow-lg",
        action: (
          <div className="w-2 h-2 bg-academic-burgundy rounded-full animate-pulse"></div>
        ),
        duration: 2000,
      });
    } finally {
      setShowNewSessionConfirmation(false);
    }
  };

  const cancelNewSession = () => {
    setShowNewSessionConfirmation(false);
  };

  const handleDeleteUploadedFileName = async (fileName: string) => {
    if (skipDeleteConfirmation) {
      // Direct delete if user chose to remember their decision
      await removeUploadedFileName(fileName);
    } else {
      setPreviewNotAvailableFileName(fileName);
      setShowDeleteConfirmation(true);
    }
  };

  const toggleMetadata = (messageId: string) => {
    setShowMetadata(prev => ({
      ...prev,
      [messageId]: !prev[messageId]
    }));
  };

  const togglePDFViewer = () => {
    if (isMobile) {
      setShowMobilePDF(!showMobilePDF);
    } else {
      setShowPDFViewer(!showPDFViewer);
    }
  };

  return (
    <section 
      id="chat" 
      className={cn(
        "bg-gradient-to-br from-background to-academic-light-rose/10 transition-all duration-500",
        isFullscreen 
          ? "fixed inset-0 z-50 p-2 md:p-4" 
          : "py-10 md:py-20"
      )}
    >
      <div className={cn("transition-all duration-500", isFullscreen ? "h-full" : "container px-3 md:px-6")}>
        {!isFullscreen && (
          <div className="text-center mb-6 md:mb-12">
            <h2 className="text-xl md:text-4xl font-bold mb-3 md:mb-4">
              Start Your Study Session
            </h2>
            <p className="text-base md:text-xl text-muted-foreground max-w-2xl mx-auto">
              Upload your documents or ask questions about any academic topic
            </p>
          </div>
        )}

        <div className={cn(
          "transition-all duration-500", 
          isFullscreen 
            ? "h-full" 
            : "max-w-7xl mx-auto",
          !isFullscreen && (!showPDFViewer || selectedMode !== 'pdf') && "flex justify-center"
        )}>
          {selectedMode === 'pdf' && (attachedFiles.length > 0 || currentPDF) && showPDFViewer ? (
            <PanelGroup 
              direction="horizontal" 
              className={cn("transition-all duration-500", isFullscreen ? "h-full" : "h-[500px]")}
            >
              {/* Chat Interface Panel */}
              <Panel defaultSize={65} minSize={40}>
                <Card className={cn(
                  "overflow-hidden shadow-xl transition-all duration-500", 
                  isFullscreen ? "h-full flex flex-col" : "max-w-4xl w-full"
                )}>
                  {/* Chat Header Section */}
                  <ChatHeader
                    selectedMode={selectedMode}
                    chatModes={chatModes}
                    onModeChange={setSelectedMode}
                    isAuthenticated={isAuthenticated}
                    user={user}
                  />

                  {/* Login Prompt Banner */}
                  {!isFullscreen && !isAuthenticated && (
                    <div className="border-b border-academic-teal/20 bg-gradient-to-r from-academic-teal/5 to-academic-burgundy/5 p-2 md:p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 md:gap-3">
                          <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-academic-teal/10 flex items-center justify-center flex-shrink-0">
                            <Brain className="w-3 h-3 md:w-4 md:h-4 text-academic-teal" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs md:text-base font-medium text-foreground leading-tight">
                              Save your chat history
                            </p>
                            <p className="text-xs text-muted-foreground leading-tight hidden sm:block">
                              Login or sign up to save your conversations and access them later
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
                          <Button 
                            variant="academic" 
                            size="sm" 
                            className="text-xs px-3 md:px-4 py-1 md:py-2 h-7 md:h-9"
                            onClick={() => setShowAuthModal(true)}
                          >
                            Login / Sign Up
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Messages Section */}
                  <div 
                    ref={messagesContainerRef}
                    className={cn(
                      "overflow-y-auto transition-all duration-500", 
                      isFullscreen ? "flex-1" : "h-80 md:h-96"
                    )}
                  >
                    <ChatMessages
                      messages={currentMessages}
                      isLoading={isLoading}
                      onScrollToBottom={scrollToBottom}
                      showMetadata={showMetadata}
                      onToggleMetadata={toggleMetadata}
                    />
                  </div>

                  {/* Source Section */}
                  <SourceSection
                    selectedMode={selectedMode}
                    attachedFiles={attachedFiles}
                    uploadedFileNames={uploadedFileNames}
                    uploadingFiles={uploadingFiles}
                    currentPDF={currentPDF}
                    showPDFViewer={showPDFViewer}
                    showMobilePDF={showMobilePDF}
                    isFilePanelExpanded={isFilePanelExpanded}
                    onFileUpload={handleFileUpload}
                    onFileDelete={handleDeleteFile}
                    onUploadedFileDelete={handleDeleteUploadedFileName}
                    onPDFSelect={setCurrentPDF}
                    onPDFViewerToggle={setShowPDFViewer}
                    onMobilePDFToggle={setShowMobilePDF}
                    onFilePanelToggle={setIsFilePanelExpanded}
                    onUploadedFileNameClick={handleUploadedFileNameClick}
                  />

                  {/* Input Section */}
                  <ChatInput
                    onSendMessage={handleSendMessage}
                    onFileUpload={handleFileUpload}
                    isLoading={uploadLoading}
                    selectedMode={selectedMode}
                    placeholder={
                      selectedMode === 'pdf'
                        ? "Ask a question about your uploaded documents..."
                        : "Search for academic information on the web..."
                    }
                  />
                </Card>
              </Panel>
              
              <PanelResizeHandle className="bg-border hover:bg-academic-teal/50 transition-colors" />
              
              {/* PDF Section */}
              <Panel defaultSize={35} minSize={20} maxSize={60}>
                <PDFSection
                  currentPDF={currentPDF}
                  showPDFViewer={showPDFViewer}
                  onPDFViewerToggle={setShowPDFViewer}
                />
              </Panel>
            </PanelGroup>
          ) : (
            <Card className={cn(
              "overflow-hidden shadow-xl transition-all duration-500", 
              isFullscreen ? "h-full flex flex-col" : "max-w-4xl w-full"
            )}>
              {/* Chat Header Section */}
              <ChatHeader
                selectedMode={selectedMode}
                chatModes={chatModes}
                onModeChange={setSelectedMode}
                isAuthenticated={isAuthenticated}
                user={user}
              />

              {/* Login Prompt Banner */}
              {!isFullscreen && !isAuthenticated && (
                <div className="border-b border-academic-teal/20 bg-gradient-to-r from-academic-teal/5 to-academic-burgundy/5 p-2 md:p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 md:gap-3">
                      <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-academic-teal/10 flex items-center justify-center flex-shrink-0">
                        <Brain className="w-3 h-3 md:w-4 md:h-4 text-academic-teal" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs md:text-base font-medium text-foreground leading-tight">
                          Save your chat history
                        </p>
                        <p className="text-xs text-muted-foreground leading-tight hidden sm:block">
                          Login or sign up to save your conversations and access them later
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
                      <Button 
                        variant="academic" 
                        size="sm" 
                        className="text-xs px-3 md:px-4 py-1 md:py-2 h-7 md:h-9"
                        onClick={() => setShowAuthModal(true)}
                      >
                        Login / Sign Up
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Messages Section */}
              <div 
                ref={messagesContainerRef}
                className={cn(
                  "overflow-y-auto transition-all duration-500", 
                  isFullscreen ? "flex-1" : "h-80 md:h-96"
                )}
              >
                <ChatMessages
                  messages={currentMessages}
                  isLoading={isLoading}
                  onScrollToBottom={scrollToBottom}
                  showMetadata={showMetadata}
                  onToggleMetadata={toggleMetadata}
                />
              </div>

              {/* Source Section */}
              <SourceSection
                selectedMode={selectedMode}
                attachedFiles={attachedFiles}
                uploadedFileNames={uploadedFileNames}
                uploadingFiles={uploadingFiles}
                currentPDF={currentPDF}
                showPDFViewer={showPDFViewer}
                showMobilePDF={showMobilePDF}
                isFilePanelExpanded={isFilePanelExpanded}
                onFileUpload={handleFileUpload}
                onFileDelete={handleDeleteFile}
                onUploadedFileDelete={handleDeleteUploadedFileName}
                onPDFSelect={setCurrentPDF}
                onPDFViewerToggle={setShowPDFViewer}
                onMobilePDFToggle={setShowMobilePDF}
                onFilePanelToggle={setIsFilePanelExpanded}
                onUploadedFileNameClick={handleUploadedFileNameClick}
              />

              {/* Input Section */}
              <ChatInput
                onSendMessage={handleSendMessage}
                onFileUpload={handleFileUpload}
                isLoading={uploadLoading}
                selectedMode={selectedMode}
                placeholder={
                  selectedMode === 'pdf' 
                    ? "Ask questions about your uploaded PDFs..." 
                    : "Ask me anything about your studies..."
                }
              />
            </Card>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={(e) => handleFileUpload(Array.from(e.target.files || []))}
            className="hidden"
          />
        </div>
      </div>

      {/* Delete File Confirmation Dialog - Desktop */}
      {!isMobile && (
        <AlertDialog open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
          <AlertDialogContent className="max-w-md border-2 border-academic-burgundy/20 bg-gradient-to-br from-background to-academic-light-rose/5 backdrop-blur-sm">
            <AlertDialogHeader className="text-center">
              <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-gradient-to-r from-academic-burgundy to-academic-rose flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <AlertDialogTitle className="text-lg font-bold bg-gradient-to-r from-academic-burgundy to-academic-rose bg-clip-text text-transparent text-center">
                Remove Document
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed">
                Removing this document will permanently delete it from your study session. You will lose access to ask questions about this document.
              </AlertDialogDescription>
            </AlertDialogHeader>
            
            {/* Remember Decision Checkbox - Left Aligned */}
            <div className="flex items-start space-x-3 mb-6">
              <input
                type="checkbox"
                id="remember-delete-desktop"
                checked={rememberDeleteDecision}
                onChange={(e) => setRememberDeleteDecision(e.target.checked)}
                className="w-4 h-4 mt-0.5 text-academic-teal bg-background border-academic-teal/30 rounded focus:ring-academic-teal/50 focus:ring-2 flex-shrink-0"
              />
              <label htmlFor="remember-delete-desktop" className="text-sm text-muted-foreground cursor-pointer leading-relaxed">
                Remember my decision for future deletions
              </label>
            </div>
            
            <AlertDialogFooter className="flex flex-col gap-3">
              <AlertDialogAction 
                onClick={confirmDeleteFile} 
                className="w-full bg-gradient-to-r from-academic-teal to-academic-burgundy text-white hover:from-academic-teal/90 hover:to-academic-burgundy/90 shadow-lg hover:shadow-xl transition-all duration-200 text-sm py-3"
              >
                Remove Document
              </AlertDialogAction>
              <AlertDialogCancel 
                onClick={cancelDeleteFile}
                className="w-full border-2 border-academic-teal/30 text-academic-teal hover:bg-academic-teal/10 hover:border-academic-teal/50 transition-all duration-200 text-sm py-3 rounded-lg"
              >
                Keep Document
              </AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Preview Not Available Popup - Desktop */}
      {!isMobile && (
        <AlertDialog open={showPreviewNotAvailable} onOpenChange={setShowPreviewNotAvailable}>
          <AlertDialogContent className="max-w-sm border-2 border-academic-burgundy/20 bg-gradient-to-br from-background to-academic-light-rose/5 backdrop-blur-sm">
            <AlertDialogHeader className="text-center">
              <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-gradient-to-r from-academic-burgundy to-academic-rose flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <AlertDialogTitle className="text-base font-bold bg-gradient-to-r from-academic-burgundy to-academic-rose bg-clip-text text-transparent text-center">
                Preview Not Available
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed text-center">
                Sorry, we don't have preview of this file: <span className="font-medium text-foreground">{previewNotAvailableFileName}</span>
                <br /><br />
                This file was uploaded in a previous session and is available for asking questions, but preview functionality is not available.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex justify-center">
              <AlertDialogAction 
                onClick={() => setShowPreviewNotAvailable(false)}
                className="w-full bg-gradient-to-r from-academic-teal to-academic-burgundy text-white hover:from-academic-teal/90 hover:to-academic-burgundy/90 shadow-lg hover:shadow-xl transition-all duration-200"
              >
                Got it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* New Session Dialog - Only show for authenticated users */}
      {isAuthenticated && (
        <NewSessionDialog
          open={showNewSessionConfirmation}
          onOpenChange={setShowNewSessionConfirmation}
          selectedMode={selectedMode}
          onConfirm={confirmNewSession}
          onCancel={cancelNewSession}
        />
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </section>
  );
};

export default ChatInterfaceRefactored;
