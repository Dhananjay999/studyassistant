import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PDFViewer } from "@/components/PDFViewer";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import ReactMarkdown from "react-markdown";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
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

const ChatInterface = () => {
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

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
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
                  {/* Chat Mode Selection */}
                  <div className="border-b p-3 md:p-4 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-row gap-2 md:gap-3 flex-1">
                        {chatModes.map((mode) => {
                          const IconComponent = mode.icon;
                          return (
                            <button
                              key={mode.id}
                              onClick={() => setSelectedMode(mode.id)}
                              className={cn(
                                "flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-xl transition-all duration-200 flex-1 text-left",
                                selectedMode === mode.id
                                  ? "bg-academic-teal text-white shadow-lg"
                                  : "bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
                              )}
                            >
                              <IconComponent className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
                              <div className="min-w-0">
                                <div className="font-semibold text-xs md:text-base">{mode.label}</div>
                                <div className="text-xs opacity-80 hidden md:block">{mode.description}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2 md:gap-3 ml-2 md:ml-4">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={handleStartNewSession}
                          className="h-8 w-8 md:h-10 md:w-10 border-academic-burgundy/30 text-academic-burgundy hover:bg-academic-burgundy/10 hover:border-academic-burgundy/50 transition-all duration-200 rounded-xl shadow-md"
                          title="Start new chat session"
                        >
                          <RefreshCw className="w-3 h-3 md:w-4 md:h-4" />
                        </Button>
                        <Button
                          variant="academicOutline"
                          size="icon"
                          onClick={() => navigate('/chat')}
                          className="h-8 w-8 md:h-10 md:w-10 flex-shrink-0 rounded-xl shadow-md"
                          title="Open full-screen chat"
                        >
                          <Maximize2 className="w-3 h-3 md:w-4 md:h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

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

                  {/* Messages */}
                  <div 
                    ref={messagesContainerRef}
                    className={cn(
                      "overflow-y-auto p-3 md:p-4 space-y-3 md:space-y-4 transition-all duration-500", 
                      isFullscreen ? "flex-1" : "h-80 md:h-96"
                    )}
                  >
                    {currentMessages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          "flex gap-3",
                          message.type === 'user' ? "justify-end" : "justify-start"
                        )}
                      >
                        {message.type === 'bot' && (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-r from-academic-teal to-academic-burgundy flex items-center justify-center flex-shrink-0">
                            <Bot className="w-4 h-4 text-white" />
                          </div>
                        )}
                        
                        <div
                          className={cn(
                            "max-w-[280px] sm:max-w-md lg:max-w-lg p-3 rounded-lg",
                            message.type === 'user'
                              ? "bg-academic-teal text-white"
                              : "bg-muted text-foreground"
                          )}
                        >
                          {message.type === 'bot' ? (
                            <div className="prose-chat">
                              <ReactMarkdown
                                components={{
                                  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
                                }}
                              >
                                {message.content}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <p className="text-sm">{message.content}</p>
                          )}
                          
                      
                          
                          {message.attachments && message.attachments.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {message.attachments.map((file, index) => (
                                <div key={index} className="flex items-center gap-2 text-xs opacity-80">
                                  <FileText className="w-3 h-3" />
                                  <span>{file.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {message.type === 'user' && (
                          <div className="w-8 h-8 rounded-full bg-academic-rose flex items-center justify-center flex-shrink-0">
                            <User className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </div>
                    ))}
                    
                    {isLoading && (
                      <div className="flex gap-3 justify-start">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-academic-teal to-academic-burgundy flex items-center justify-center">
                          <Bot className="w-4 h-4 text-white" />
                        </div>
                        <div className="bg-muted p-3 rounded-lg">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-academic-teal rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-academic-burgundy rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                            <div className="w-2 h-2 bg-academic-rose rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* File attachments preview */}
                  {selectedMode === 'pdf' && (attachedFiles.length > 0 || uploadedFileNames.length > 0) && (
                    <div className="border-t bg-muted/30">
                      <div className="px-3 md:px-4 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">Uploaded Files</span>
                          <button
                            onClick={() => {
                              if (isMobile) {
                                setShowMobileFileSheet(true);
                              } else {
                                setIsFilePanelExpanded(!isFilePanelExpanded);
                              }
                            }}
                            className="text-xs text-academic-teal hover:text-academic-teal/80 transition-colors flex items-center gap-1"
                          >
                            {isFilePanelExpanded ? 'Collapse' : 'Expand'}
                            <ChevronDown className={cn("w-3 h-3 transition-transform", isFilePanelExpanded && "rotate-180")} />
                          </button>
                        </div>
                        <div className={cn(
                          "flex flex-wrap gap-2 transition-all duration-30",
                          isFilePanelExpanded ? "max-h-32 overflow-y-auto 0 mt-2" : "max-h-0 overflow-hidden"
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
                                onClick={() => {
                                  // Set the clicked file as the current PDF
                                  setCurrentPDF(file);
                                  if (isMobile) {
                                    setShowMobilePDF(true);
                                  } else {
                                    setShowPDFViewer(true);
                                  }
                                }}
                              >
                                <FileText className="w-3 h-3" />
                                <span className="text-xs font-medium">{file.name}</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteFile(index);
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
                              onClick={() => handleUploadedFileNameClick(fileName)}
                            >
                              <FileText className="w-3 h-3" />
                              <span className="text-xs font-medium">{fileName}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteUploadedFileName(fileName);
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

                  {/* Input */}
                  <div className="border-t p-3 md:p-4 bg-gradient-to-r from-background via-muted/20 to-background">
                    <div className="flex gap-3 items-end align-center">
                      <div className="flex-1 relative">
                        <Textarea
                          value={inputValue}
                          onChange={(e) => setInputValue(e.target.value)}
                          placeholder={
                            selectedMode === 'pdf'
                              ? "Ask a question about your uploaded documents..."
                              : "Search for academic information on the web..."
                          }
                          className="min-h-[56px] md:min-h-[60px] resize-none border-2 border-border/50 focus:border-academic-teal/50 rounded-xl bg-background/80 backdrop-blur-sm shadow-sm transition-all duration-200 placeholder:text-muted-foreground/70 pr-12 scrollbar-hide"
                          disabled={uploadLoading}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                        />
                        {selectedMode === 'pdf' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadLoading}
                            title="Upload PDF"
                            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 hover:bg-academic-teal/10 text-muted-foreground hover:text-academic-teal transition-colors rounded-lg"
                          >
                            {uploadLoading ? (
                              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Upload className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                      </div>
                      <Button
                        variant="academic"
                        size="icon"
                        onClick={handleSendMessage}
                        disabled={(!isValidMessage(inputValue) && attachedFiles.length === 0) || uploadLoading}
                        className="h-12 w-12 md:h-10 md:w-10 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                      >
                        {uploadLoading ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Send className="w-4 h-4 text-white" />
                        )}
                      </Button>
                    </div>
                  </div>
                </Card>
              </Panel>
              
              <PanelResizeHandle className="bg-border hover:bg-academic-teal/50 transition-colors" />
              
              {/* PDF Viewer Panel */}
              <Panel defaultSize={35} minSize={20} maxSize={60}>
                <div className="h-full flex flex-col">
                  {/* PDF Viewer Header */}
                  <div className="flex items-center justify-between p-3 border-b bg-card/30">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-academic-teal" />
                      <span className="font-medium text-sm truncate">{currentPDF?.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowPDFViewer(false)}
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
                      onToggleVisibility={() => setShowPDFViewer(false)}
                      className="h-full"
                    />
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          ) : (
            <Card className={cn(
              "overflow-hidden shadow-xl transition-all duration-500", 
              isFullscreen ? "h-full flex flex-col" : "max-w-4xl w-full"
            )}>
              {/* Chat Mode Selection */}
              <div className="border-b p-3 md:p-4 bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex flex-row gap-2 md:gap-3 flex-1">
                    {chatModes.map((mode) => {
                      const IconComponent = mode.icon;
                      return (
                        <button
                          key={mode.id}
                          onClick={() => setSelectedMode(mode.id)}
                          className={cn(
                            "flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-xl transition-all duration-200 flex-1 text-left",
                            selectedMode === mode.id
                              ? "bg-academic-teal text-white shadow-lg"
                              : "bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <IconComponent className="w-4 h-4 md:w-5 md:h-5 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-xs md:text-base">{mode.label}</div>
                            <div className="text-xs opacity-80 hidden md:block">{mode.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                      <div className="flex items-center gap-2 md:gap-3 ml-2 md:ml-4">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={handleStartNewSession}
                          className="h-8 w-8 md:h-10 md:w-10 border-academic-burgundy/30 text-academic-burgundy hover:bg-academic-burgundy/10 hover:border-academic-burgundy/50 transition-all duration-200 rounded-xl shadow-md"
                          title="Start new chat session"
                        >
                          <RefreshCw className="w-3 h-3 md:w-4 md:h-4" />
                        </Button>

                  <Button
                    variant="academicOutline"
                    size="icon"
                    onClick={() => navigate('/chat')}
                    className="h-8 w-8 md:h-10 md:w-10 flex-shrink-0 rounded-xl shadow-md"
                    title="Open full-screen chat"
                  >
                    <Maximize2 className="w-3 h-3 md:w-4 md:h-4" />
                  </Button>
                      </div>
                </div>
              </div>

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

              {/* Messages */}
              <div 
                ref={messagesContainerRef}
                className={cn(
                  "overflow-y-auto p-3 md:p-4 space-y-3 md:space-y-4 transition-all duration-500", 
                  isFullscreen ? "flex-1" : "h-80 md:h-96"
                )}
              >
                {currentMessages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex gap-2 md:gap-3",
                      message.type === 'user' ? "justify-end" : "justify-start"
                    )}
                  >
                    {message.type === 'bot' && (
                      <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-gradient-to-r from-academic-teal to-academic-burgundy flex items-center justify-center flex-shrink-0">
                        <Bot className="w-3 h-3 md:w-4 md:h-4 text-white" />
                      </div>
                    )}
                    
                    <div
                      className={cn(
                        "max-w-[280px] sm:max-w-md lg:max-w-lg p-3 rounded-lg",
                        message.type === 'user'
                          ? "bg-academic-teal text-white"
                          : "bg-muted text-foreground"
                      )}
                    >
                      {message.type === 'bot' ? (
                        <div className="prose-chat">
                          <ReactMarkdown
                            components={{
                              a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-sm">{message.content}</p>
                      )}
                      
                    
                      
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {message.attachments.map((file, index) => (
                            <div key={index} className="flex items-center gap-2 text-xs opacity-80">
                              <FileText className="w-3 h-3" />
                              <span>{file.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {message.type === 'user' && (
                      <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-academic-rose flex items-center justify-center flex-shrink-0">
                        <User className="w-3 h-3 md:w-4 md:h-4 text-white" />
                      </div>
                    )}
                  </div>
                ))}
                
                {isLoading && (
                  <div className="flex gap-2 md:gap-3 justify-start">
                    <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-gradient-to-r from-academic-teal to-academic-burgundy flex items-center justify-center">
                      <Bot className="w-3 h-3 md:w-4 md:h-4 text-white" />
                    </div>
                    <div className="bg-muted p-3 rounded-lg">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-academic-teal rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-academic-burgundy rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-academic-rose rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* File attachments preview */}
              {selectedMode === 'pdf' && (attachedFiles.length > 0 || uploadedFileNames.length > 0) && (
                <div className="border-t bg-muted/30">
                  <div className="px-3 md:px-4 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Uploaded Files</span>
                      <button
                        onClick={() => {
                          if (isMobile) {
                            setShowMobileFileSheet(true);
                          } else {
                            setIsFilePanelExpanded(!isFilePanelExpanded);
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
                      isFilePanelExpanded ? "max-h-32 overflow-y-auto  mt-2" : "max-h-0 overflow-hidden"
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
                            onClick={() => {
                              // Set the clicked file as the current PDF
                              setCurrentPDF(file);
                              if (isMobile) {
                                setShowMobilePDF(true);
                              } else {
                                setShowPDFViewer(true);
                              }
                            }}
                          >
                            <FileText className="w-3 h-3" />
                            <span className="text-xs font-medium">{file.name}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteFile(index);
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
                        onClick={() => handleUploadedFileNameClick(fileName)}
                      >
                        <FileText className="w-3 h-3" />
                        <span className="text-xs font-medium">{fileName}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteUploadedFileName(fileName);
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

              {/* Input */}
              <div className="border-t bg-gradient-to-r from-background via-muted/20 to-background p-3 md:p-6">
                <div className="flex gap-3 md:gap-4 items-center">
                  <div className="flex-1 relative">
                    <Textarea
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder={
                        selectedMode === 'pdf' 
                          ? "Ask questions about your uploaded PDFs..." 
                          : "Ask me anything about your studies..."
                      }
                      className="resize-none min-h-[56px] md:min-h-[52px] border-2 border-border/50 focus:border-academic-teal/50 rounded-xl bg-background/80 backdrop-blur-sm shadow-sm transition-all duration-200 placeholder:text-muted-foreground/70 pr-12 scrollbar-hide"
                      rows={1}
                      disabled={uploadLoading}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                    />
                    
                    {/* Upload button inside textarea for PDF mode */}
                    {selectedMode === 'pdf' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadLoading}
                        title="Upload PDF"
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 hover:bg-academic-teal/10 text-muted-foreground hover:text-academic-teal transition-colors rounded-lg"
                      >
                        {uploadLoading ? (
                          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                  </div>
                  
                  <Button
                    onClick={handleSendMessage}
                    disabled={(!inputValue.trim() && attachedFiles.length === 0) || isLoading}
                    className="h-10 w-10 md:h-12 md:w-12 rounded-xl bg-gradient-to-r from-academic-teal to-academic-burgundy hover:from-academic-teal/90 hover:to-academic-burgundy/90 shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    size="icon"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send className="w-5 h-5 text-white" />
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
      </div>

      {/* Mobile PDF Drawer */}
      <Drawer open={showMobilePDF} onOpenChange={setShowMobilePDF}>
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
              onToggleVisibility={() => setShowMobilePDF(false)}
              className="h-full"
            />
          </div>
        </DrawerContent>
      </Drawer>

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

      {/* Delete File Confirmation Dialog - Mobile Bottom Sheet */}
      {isMobile && (
        <Drawer open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
          <DrawerContent className="h-[65vh]">
            <DrawerHeader className="text-center">
              <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-gradient-to-r from-academic-burgundy to-academic-rose flex items-center justify-center">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <DrawerTitle className="text-lg font-bold bg-gradient-to-r from-academic-burgundy to-academic-rose bg-clip-text text-transparent">
                Remove Document
              </DrawerTitle>
              <p className="text-sm text-muted-foreground leading-relaxed mt-2">
                Removing this document will permanently delete it from your study session. You will lose access to ask questions about this document.
              </p>
            </DrawerHeader>
            
            <div className="flex-1 px-6 pb-6">
              {/* Remember Decision Checkbox - Left Aligned */}
              <div className="flex items-start space-x-3 mb-6">
                <input
                  type="checkbox"
                  id="remember-delete-mobile"
                  checked={rememberDeleteDecision}
                  onChange={(e) => setRememberDeleteDecision(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-academic-teal bg-background border-academic-teal/30 rounded focus:ring-academic-teal/50 focus:ring-2 flex-shrink-0"
                />
                <label htmlFor="remember-delete-mobile" className="text-sm text-muted-foreground cursor-pointer leading-relaxed">
                  Remember my decision for future deletions
                </label>
              </div>
              
              {/* Action Buttons */}
              <div className="flex flex-col gap-3">
                <Button
                  onClick={confirmDeleteFile}
                  className="w-full bg-gradient-to-r from-academic-teal to-academic-burgundy text-white hover:from-academic-teal/90 hover:to-academic-burgundy/90 shadow-lg hover:shadow-xl transition-all duration-200 py-3"
                >
                  Remove Document
                </Button>
                <Button
                  variant="outline"
                  onClick={cancelDeleteFile}
                  className="w-full border-2 border-academic-teal/30 text-academic-teal hover:bg-academic-teal/10 hover:border-academic-teal/50 transition-all duration-200 py-3"
                >
                  Keep Document
                </Button>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
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

      {/* Preview Not Available Popup - Mobile Bottom Sheet */}
      {isMobile && (
        <Drawer open={showPreviewNotAvailable} onOpenChange={setShowPreviewNotAvailable}>
          <DrawerContent className="h-[50vh]">
            <DrawerHeader className="text-center">
              <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-gradient-to-r from-academic-burgundy to-academic-rose flex items-center justify-center">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <DrawerTitle className="text-base font-bold bg-gradient-to-r from-academic-burgundy to-academic-rose bg-clip-text text-transparent">
                Preview Not Available
              </DrawerTitle>
              <p className="text-sm text-muted-foreground leading-relaxed mt-2">
                Sorry, we don't have preview of this file: <span className="font-medium text-foreground">{previewNotAvailableFileName}</span>
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed mt-2">
                This file was uploaded in a previous session and is available for asking questions, but preview functionality is not available.
              </p>
            </DrawerHeader>
            
            <div className="flex-1 px-6 pb-6 flex items-end">
              <Button
                onClick={() => setShowPreviewNotAvailable(false)}
                className="w-full bg-gradient-to-r from-academic-teal to-academic-burgundy text-white hover:from-academic-teal/90 hover:to-academic-burgundy/90 shadow-lg hover:shadow-xl transition-all duration-200 py-3"
              >
                Got it
              </Button>
            </div>
          </DrawerContent>
        </Drawer>
      )}

      {/* Mobile File Bottom Sheet */}
      <Drawer open={showMobileFileSheet} onOpenChange={setShowMobileFileSheet}>
        <DrawerContent className="h-[70vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Uploaded Files
            </DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              {/* Currently attached files (with preview) */}
              {attachedFiles.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-3">Current Session Files</h3>
                  <div className="flex flex-wrap gap-2">
                    {attachedFiles.map((file, index) => (
                      <Badge 
                        key={`mobile-attached-${index}`} 
                        variant="secondary" 
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer flex-shrink-0",
                          currentPDF?.name === file.name && (showPDFViewer || showMobilePDF) && "bg-academic-teal text-white hover:bg-academic-teal/90 shadow-md"
                        )}
                        onClick={() => {
                          // Set the clicked file as the current PDF
                          setCurrentPDF(file);
                          setShowMobilePDF(true);
                          setShowMobileFileSheet(false);
                        }}
                      >
                        <FileText className="w-3 h-3" />
                        <span className="text-xs font-medium">{file.name}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFile(index);
                          }}
                          className="hover:bg-background/50 rounded-full p-1 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Previously uploaded files (no preview) */}
              {uploadedFileNames.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-3">Previous Session Files</h3>
                  <div className="flex flex-wrap gap-2">
                    {uploadedFileNames.map((fileName, index) => (
                      <Badge 
                        key={`mobile-uploaded-${index}`} 
                        variant="outline" 
                        className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer border-dashed border-academic-burgundy/30 text-academic-burgundy/70 hover:border-academic-burgundy/50 hover:text-academic-burgundy flex-shrink-0"
                        onClick={() => {
                          handleUploadedFileNameClick(fileName);
                          setShowMobileFileSheet(false);
                        }}
                      >
                        <FileText className="w-3 h-3" />
                        <span className="text-xs font-medium">{fileName}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteUploadedFileName(fileName);
                          }}
                          className="hover:bg-background/50 rounded-full p-1 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {attachedFiles.length === 0 && uploadedFileNames.length === 0 && (
                <div className="text-center py-8">
                  <FileText className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No files uploaded yet</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Upload PDFs to start asking questions</p>
                </div>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>

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

export default ChatInterface;