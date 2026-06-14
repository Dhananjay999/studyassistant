import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { PDFViewer } from "@/components/PDFViewer";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from "@/components/ui/drawer";
import { 
  ArrowLeft, 
  Plus, 
  Search, 
  FileText, 
  MessageSquare, 
  Settings,
  X,
  Check,
  ChevronRight,
  Bookmark,
  Copy,
  Share2,
  FileDown,
  Volume2,
  Network,
  MoreHorizontal,
  User,
  Bot,
  Send,
  Upload,
  Minimize,
  Maximize2,
  Eye,
  EyeOff
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { Message, ChatMode } from "@/types";
import ChatHeader from "@/components/chat/ChatHeader";
import ChatMessages from "@/components/chat/ChatMessages";
import ChatInput from "@/components/chat/ChatInput";
import SourcesPanel from "@/components/chat/SourcesPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { apiService } from "@/services";
import { useToast } from "@/hooks/use-toast";

const ChatPage = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  
  // State management
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'pdf' | 'web'>('pdf');
  const [showMobileSources, setShowMobileSources] = useState(false);
  
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
  
  // File management state
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadedFileNames, setUploadedFileNames] = useState<string[]>([]);
  const [currentPDF, setCurrentPDF] = useState<File | null>(null);
  const [showPDFViewer, setShowPDFViewer] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<{ file: File; progress: number }[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // Chat modes configuration
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
      icon: Search,
      description: 'Search the web for academic information',
      searchMode: 'web_search'
    }
  ];

  // Fetch uploaded files on component mount
  useEffect(() => {
    const fetchUploadedFiles = async () => {
      if (selectedMode === 'pdf') {
        try {
          const response = await apiService.getUploadedFiles();
          setUploadedFileNames(response.file_names);
        } catch (error) {
          console.error('Failed to fetch uploaded files:', error);
        }
      }
    };

    fetchUploadedFiles();
  }, [selectedMode]);

  // Auto-select files when they're uploaded
  useEffect(() => {
    const newFiles = attachedFiles.filter(file => !selectedFiles.has(file.name));
    if (newFiles.length > 0) {
      setSelectedFiles(prev => {
        const newSet = new Set(prev);
        newFiles.forEach(file => newSet.add(file.name));
        return newSet;
      });
    }
  }, [attachedFiles]);

  // Auto-collapse/expand sources panel based on mode
  useEffect(() => {
    if (selectedMode === 'web') {
      setIsCollapsed(true);
    } else if (selectedMode === 'pdf') {
      setIsCollapsed(false);
    }
  }, [selectedMode]);



  const handleSendMessage = async (content: string) => {
    if (!content.trim()) return;

    const newMessage: Message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'user',
      content,
      timestamp: new Date(),
    };

    // Add user message to the appropriate chat based on selected mode
    if (selectedMode === 'pdf') {
      setPdfMessages(prev => [...prev, newMessage]);
    } else {
      setWebMessages(prev => [...prev, newMessage]);
    }
  };

  // Handle bot response from MessagePair component
  const handleBotResponse = useCallback((botMessage: Message, mode: 'pdf' | 'web') => {
    if (mode === 'pdf') {
      setPdfMessages(prev => [...prev, botMessage]);
    } else {
      setWebMessages(prev => [...prev, botMessage]);
    }
  }, []);

  // Handle error from MessagePair component
  const handleError = useCallback((error: string) => {
    console.error('Chat error:', error);
    // You can add toast notification here if needed
  }, []);

  const handleFileUpload = async (files: File[]) => {
    // Immediately add files to the uploading list with progress
    const newUploadingFiles = files.map(file => ({ file, progress: 0 }));
    setUploadingFiles(prev => [...prev, ...newUploadingFiles]);
    
    // Also add to attached files immediately for display
    setAttachedFiles(prev => [...prev, ...files]);

    try {
      // Start the actual upload first
      const uploadPromise = apiService.uploadFiles(files);
      
      // Simulate progress over 4-5 seconds while upload is happening
      const progressPromises = files.map(async (file) => {
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
      
      // Remove from uploading list
      setUploadingFiles(prev => prev.filter(uf => !files.includes(uf.file)));
      
      const uploadMessage: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: `Successfully uploaded ${files.length} PDF file(s). You can now ask questions about your documents.`,
        timestamp: new Date()
      };
      
      // Add upload message to PDF chat since it's related to PDF functionality
      setPdfMessages(prev => [...prev, uploadMessage]);
      
      toast({
        title: "Files Uploaded",
        description: `Successfully uploaded ${files.length} file(s)`,
      });
    } catch (error) {
      console.error('File upload failed:', error);
      
      // Remove from uploading list and attached files on error
      setUploadingFiles(prev => prev.filter(uf => !files.includes(uf.file)));
      setAttachedFiles(prev => prev.filter(file => !files.includes(file)));
      
      toast({
        title: "Upload Failed",
        description: "Failed to upload files. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleFileDelete = async (fileName: string) => {
    try {
      await apiService.deleteFile(fileName);
      setUploadedFileNames(prev => prev.filter(name => name !== fileName));
      setAttachedFiles(prev => prev.filter(file => file.name !== fileName));
      
      // Remove from selected files
      setSelectedFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(fileName);
        return newSet;
      });
      
      // If the deleted file is currently being viewed, close the viewer
      if (currentPDF?.name === fileName) {
        setCurrentPDF(null);
        setShowPDFViewer(false);
      }
      
      toast({
        title: "File Deleted",
        description: "File has been removed successfully",
      });
    } catch (error) {
      console.error('Failed to delete file:', error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete file. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handlePDFSelect = (file: File | null) => {
    setCurrentPDF(file);
    if (file) {
      setShowPDFViewer(true);
    } else {
      setShowPDFViewer(false);
    }
  };

  const togglePDFViewer = () => {
    setShowPDFViewer(!showPDFViewer);
  };

  const handleFileSelection = (fileName: string, isSelected: boolean) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (isSelected) {
        newSet.add(fileName);
      } else {
        newSet.delete(fileName);
      }
      return newSet;
    });
  };

  const handleSelectAll = (isSelected: boolean) => {
    const allFileNames = [
      ...attachedFiles.map(file => file.name),
      ...uploadedFileNames
    ];
    
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (isSelected) {
        allFileNames.forEach(name => newSet.add(name));
      } else {
        allFileNames.forEach(name => newSet.delete(name));
      }
      return newSet;
    });
  };

  const allFileNames = [
    ...attachedFiles.map(file => file.name),
    ...uploadedFileNames
  ];
  const isAllSelected = allFileNames.length > 0 && allFileNames.every(name => selectedFiles.has(name));
  const isSomeSelected = allFileNames.some(name => selectedFiles.has(name));

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Top Navigation Bar */}
      <div className="flex items-center justify-between p-1 md:p-4 border-b bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-1 md:gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
            className="h-6 w-6 md:h-8 md:w-8"
          >
            <ArrowLeft className="h-3 w-3 md:h-4 md:w-4" />
          </Button>
          <div className="flex items-center gap-1 md:gap-2">
            <div className="w-5 h-5 md:w-8 md:h-8 rounded-md md:rounded-lg bg-gradient-to-r from-academic-teal to-academic-burgundy flex items-center justify-center">
              <MessageSquare className="h-2.5 w-2.5 md:h-4 md:w-4 text-white" />
            </div>
            <span className="font-semibold text-sm md:text-lg">Chat</span>
          </div>
        </div>
        
        <div className="flex items-center gap-0.5 md:gap-2">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              "h-6 w-6 md:h-8 md:w-8 transition-all duration-200",
              selectedMode === 'web' && isCollapsed && "text-academic-teal bg-academic-teal/10"
            )}
            title={selectedMode === 'web' && isCollapsed ? "Sources panel collapsed for web search mode" : "Toggle sources panel"}
          >
            {isCollapsed ? <Maximize2 className="h-2.5 w-2.5 md:h-4 md:w-4" /> : <Minimize className="h-2.5 w-2.5 md:h-4 md:w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 md:h-8 md:w-8"
          >
            <Settings className="h-2.5 w-2.5 md:h-4 md:w-4" />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sources Panel - Hidden on Mobile */}
        <div className={cn(
          "w-80 border-r bg-card/30 backdrop-blur-sm transition-all duration-300 overflow-hidden",
          isCollapsed && "w-0 border-r-0 opacity-0",
          isMobile && "hidden"
        )}>
          <SourcesPanel
            selectedMode={selectedMode}
            onModeChange={setSelectedMode}
            attachedFiles={attachedFiles}
            uploadedFileNames={uploadedFileNames}
            uploadingFiles={uploadingFiles}
            currentPDF={currentPDF}
            selectedFiles={selectedFiles}
            onFileUpload={handleFileUpload}
            onFileDelete={handleFileDelete}
            onPDFSelect={handlePDFSelect}
            onPDFViewerToggle={setShowPDFViewer}
            onFileSelection={handleFileSelection}
            onSelectAll={handleSelectAll}
            showPDFViewer={showPDFViewer}
            chatModes={chatModes}
            isAllSelected={isAllSelected}
            isSomeSelected={isSomeSelected}
            isMobile={false}
          />
        </div>

        {/* Chat and PDF Viewer Panels */}
        <div className="flex-1 flex">
          {showPDFViewer && currentPDF ? (
            <PanelGroup direction="horizontal" className="h-full">
              {/* Chat Panel */}
              <Panel defaultSize={60} minSize={30} maxSize={80}>
                <div className="flex flex-col h-full">
                  <ChatHeader
                    selectedMode={selectedMode}
                    chatModes={chatModes}
                    onModeChange={setSelectedMode}
                    isAuthenticated={isAuthenticated}
                    user={user}
                  />
                  
                  {/* Chat Messages - PDF Mode */}
                  <div className={cn(
                    "flex-1 flex flex-col min-h-0",
                    selectedMode !== 'pdf' && "hidden"
                  )}>
                    <ChatMessages
                      key="chat-messages-pdf"
                      messages={pdfMessages}
                      selectedMode="pdf"
                      chatModes={chatModes}
                      selectedFiles={selectedFiles}
                      onScrollToBottom={() => {}}
                      onBotResponse={(botMessage, mode) => handleBotResponse(botMessage, mode)}
                      onError={handleError}
                    />
                  </div>

                  {/* Chat Messages - Web Mode */}
                  <div className={cn(
                    "flex-1 flex flex-col min-h-0",
                    selectedMode !== 'web' && "hidden"
                  )}>
                                    <ChatMessages
                  key="chat-messages-web"
                  messages={webMessages}
                  selectedMode="web"
                  chatModes={chatModes}
                  selectedFiles={selectedFiles}
                  onScrollToBottom={() => {}}
                  onBotResponse={(botMessage, mode) => handleBotResponse(botMessage, mode)}
                  onError={handleError}
                />
                  </div>
                  
                  <ChatInput
                    onSendMessage={handleSendMessage}
                    onFileUpload={handleFileUpload}
                    isLoading={false}
                    selectedMode={selectedMode}
                    selectedFiles={selectedFiles}
                    placeholder={
                      selectedMode === 'pdf'
                        ? "Ask a question about your uploaded documents..."
                        : "Search for academic information on the web..."
                    }
                    onOpenMobileSources={() => setShowMobileSources(true)}
                    onOpenSources={() => setIsCollapsed(false)}
                    attachedFilesCount={attachedFiles.length}
                    uploadedFilesCount={uploadedFileNames.length}
                  />
                </div>
              </Panel>
              
              <PanelResizeHandle className="w-1 bg-border hover:bg-academic-teal/50 transition-colors" />
              
              {/* PDF Viewer Panel */}
              <Panel defaultSize={40} minSize={20} maxSize={70}>
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
                      onClick={togglePDFViewer}
                      className="h-6 w-6"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                  
                  {/* PDF Viewer Content */}
                  <div className="flex-1 overflow-hidden">
                    <PDFViewer
                      file={currentPDF}
                      isVisible={showPDFViewer}
                      onToggleVisibility={togglePDFViewer}
                      className="h-full"
                    />
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          ) : (
            /* Chat Panel Only */
            <div className="flex-1 flex flex-col h-full">
              <ChatHeader
                selectedMode={selectedMode}
                chatModes={chatModes}
                onModeChange={setSelectedMode}
                isAuthenticated={isAuthenticated}
                user={user}
              />
              
              {/* Chat Messages - PDF Mode */}
              <div className={cn(
                "flex-1 flex flex-col min-h-0",
                selectedMode !== 'pdf' && "hidden"
              )}>
                                                  <ChatMessages
                  key="chat-messages-pdf"
                  messages={pdfMessages}
                  selectedMode="pdf"
                  chatModes={chatModes}
                  selectedFiles={selectedFiles}
                  onScrollToBottom={() => {}}
                  onBotResponse={(botMessage, mode) => handleBotResponse(botMessage, mode)}
                  onError={handleError}
                />
              </div>

              {/* Chat Messages - Web Mode */}
              <div className={cn(
                "flex-1 flex flex-col min-h-0",
                selectedMode !== 'web' && "hidden"
              )}>
                <ChatMessages
                  key="chat-messages-web"
                  messages={webMessages}
                  selectedMode="web"
                  chatModes={chatModes}
                  selectedFiles={selectedFiles}
                  onScrollToBottom={() => {}}
                  onBotResponse={(botMessage, mode) => handleBotResponse(botMessage, mode)}
                  onError={handleError}
                />
              </div>
              
              <ChatInput
                onSendMessage={handleSendMessage}
                onFileUpload={handleFileUpload}
                isLoading={false}
                selectedMode={selectedMode}
                selectedFiles={selectedFiles}
                placeholder={
                  selectedMode === 'pdf'
                    ? "Ask a question about your uploaded documents..."
                    : "Search for academic information on the web..."
                }
                onOpenMobileSources={() => setShowMobileSources(true)}
                onOpenSources={() => setIsCollapsed(false)}
                attachedFilesCount={attachedFiles.length}
                uploadedFilesCount={uploadedFileNames.length}
              />
            </div>
          )}
        </div>
      </div>

      {/* Mobile Sources Bottom Sheet */}
      <Drawer open={showMobileSources} onOpenChange={setShowMobileSources}>
        <DrawerContent className="h-[85vh]">
          <DrawerHeader className="pb-3">
            <DrawerTitle className="flex items-center gap-2 text-lg">
              <FileText className="w-5 h-5 text-academic-teal" />
              Sources
            </DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 overflow-hidden">
            <SourcesPanel
              selectedMode={selectedMode}
              onModeChange={setSelectedMode}
              attachedFiles={attachedFiles}
              uploadedFileNames={uploadedFileNames}
              uploadingFiles={uploadingFiles}
              currentPDF={currentPDF}
              selectedFiles={selectedFiles}
              onFileUpload={handleFileUpload}
              onFileDelete={handleFileDelete}
              onPDFSelect={handlePDFSelect}
              onPDFViewerToggle={setShowPDFViewer}
              onFileSelection={handleFileSelection}
              onSelectAll={handleSelectAll}
              showPDFViewer={showPDFViewer}
              chatModes={chatModes}
              isAllSelected={isAllSelected}
              isSomeSelected={isSomeSelected}
              isMobile={true}
            />
          </div>
          <DrawerFooter>
            <Button 
              onClick={() => setShowMobileSources(false)}
              className="w-full bg-gradient-to-r from-academic-teal to-academic-burgundy hover:from-academic-teal/90 hover:to-academic-burgundy/90 text-white font-medium py-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
            >
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
};

export default ChatPage;
