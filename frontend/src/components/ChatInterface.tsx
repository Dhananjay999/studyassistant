import { useState, useRef } from "react";
import { 
  Send, 
  FileText, 
  Globe, 
  Paperclip, 
  X,
  Bot,
  User,
  Info,
  AlertCircle
} from "lucide-react";
import axios from 'axios';
axios.defaults.timeout = 90000;

// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

interface Message {
  id: string;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
  attachments?: File[];
  metadata?: {
    sources: Array<{
      name: string;
      pageNumber?: number;
      title?: string;
      type: 'pdf' | 'web';
      link?: string;
    }>;
  };
  error?: boolean;
}

interface ChatMode {
  id: 'pdf' | 'web';
  label: string;
  description: string;
}

const ChatInterface = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'bot',
      content: 'Hello! I\'m your AI study assistant. I can help you with questions from your uploaded PDFs or search the web for academic information. How can I assist you today?',
      timestamp: new Date(),
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [selectedMode, setSelectedMode] = useState<'pdf' | 'web'>('pdf');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showMetadata, setShowMetadata] = useState<Record<string, boolean>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [hasUploadedFiles, setHasUploadedFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // API Functions
  const uploadFiles = async (files: File[]) => {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('file', file);
    });

    try {
      const response = await api.post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            files.forEach(file => {
              setUploadProgress(prev => ({
                ...prev,
                [file.name]: progress
              }));
            });
          }
        },
      });
      
      setHasUploadedFiles(true);
      return response.data;
    } catch (error) {
      console.error('Upload failed:', error);
      throw error;
    }
  };

  const sendChatMessage = async (message: string, searchMode: string, nResults: number = 5) => {
    try {
      const response = await api.post('/chat', {
        message: message,
        n_results: nResults,
        search_mode: searchMode === 'pdf' ? 'study_material' : 'web_search'
      });
      
      return response.data;
    } catch (error) {
      console.error('Chat request failed:', error);
      throw error;
    }
  };

  const processMetadata = (metadata: any[], searchMode: string) => {
    if (searchMode === 'study_material') {
      return metadata.map(meta => ({
        name: meta.filename || 'Unknown file',
        pageNumber: meta.page_number || 1,
        title: meta.filename || 'PDF Document',
        type: 'pdf' as const
      }));
    } else {
      return metadata.map(meta => ({
        name: meta.link || '',
        title: meta.title || 'Web Result',
        type: 'web' as const,
        link: meta.link
      }));
    }
  };

  const chatModes: ChatMode[] = [
    {
      id: 'pdf',
      label: 'From PDF',
      description: 'Ask questions about your uploaded documents'
    },
    {
      id: 'web',
      label: 'Web Results',
      description: 'Search the web for academic information'
    }
  ];

  const handleSendMessage = async () => {
    if (!inputValue.trim() && attachedFiles.length === 0) return;

    if (selectedMode === 'pdf' && !hasUploadedFiles && attachedFiles.length === 0) {
      const errorMessage: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: 'Please upload PDF files first before asking questions about them.',
        timestamp: new Date(),
        error: true
      };
      setMessages(prev => [...prev, errorMessage]);
      return;
    }

    const newMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: inputValue,
      timestamp: new Date(),
      attachments: attachedFiles.length > 0 ? [...attachedFiles] : undefined
    };

    setMessages(prev => [...prev, newMessage]);
    const currentInput = inputValue;
    setInputValue('');
    setIsLoading(true);

    try {
      if (attachedFiles.length > 0) {
        await uploadFiles(attachedFiles);
        setAttachedFiles([]);
      }
//  cause of error
      const response = await sendChatMessage(currentInput, selectedMode);
      
      let botContent = '';
      let sources: any[] = [];
// 


//error point
 if (response.ans) {
        botContent = response.ans;
        if (response.metadata) {
          sources = processMetadata(response.metadata, selectedMode === 'pdf' ? 'study_material' : 'web_search');
        }
      } else {
        botContent = 'I received your message and processed it successfully.';
      }
// ....



      const botResponse: Message = {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        content: botContent,
        timestamp: new Date(),
        metadata: sources.length > 0 ? { sources } : undefined
      };

      setMessages(prev => [...prev, botResponse]);
    } catch (error) {
      console.error('Error:', error);
      
      let errorMessage = 'Sorry, I encountered an error while processing your request.';
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 422) {
          errorMessage = 'Invalid input. Please check your message and try again.';
        } else if (error.response?.status === 500) {
          errorMessage = 'Server error. Please try again later.';
        } else if (error.code === 'ECONNABORTED') {
          errorMessage = 'Request timed out. Please try again.';
        }
      }

      const errorResponse: Message = {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        content: errorMessage,
        timestamp: new Date(),
        error: true
      };
      
      setMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsLoading(false);
      setUploadProgress({});
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const pdfFiles = files.filter(file => file.type === 'application/pdf');
    setAttachedFiles(prev => [...prev, ...pdfFiles]);
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const toggleMetadata = (messageId: string) => {
    setShowMetadata(prev => ({
      ...prev,
      [messageId]: !prev[messageId]
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            AI Study Assistant
          </h1>
          <p className="text-xl text-gray-600">
            Upload your documents or ask questions about any academic topic
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-xl overflow-hidden">
          {/* Chat Mode Selection */}
          <div className="border-b bg-gray-50 p-4">
            <div className="flex gap-3">
              {chatModes.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setSelectedMode(mode.id)}
                  className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-200 flex-1 ${
                    selectedMode === mode.id
                      ? "bg-blue-600 text-white shadow-md"
                      : "bg-white hover:bg-gray-100 text-gray-600"
                  }`}
                >
                  {mode.id === 'pdf' ? (
                    <FileText className="w-5 h-5" />
                  ) : (
                    <Globe className="w-5 h-5" />
                  )}
                  <div className="text-left">
                    <div className="font-medium">{mode.label}</div>
                    <div className="text-xs opacity-80">{mode.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div className="h-96 overflow-y-auto p-4 space-y-4 bg-gray-50">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.type === 'user' ? "justify-end" : "justify-start"
                }`}
              >
                {message.type === 'bot' && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                )}
                
                <div
                  className={`max-w-xs sm:max-w-md p-3 rounded-lg ${
                    message.type === 'user'
                      ? "bg-blue-600 text-white"
                      : message.error 
                        ? "bg-red-50 text-red-800 border border-red-200"
                        : "bg-white text-gray-800 border border-gray-200"
                  }`}
                >
                  {message.error && (
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-xs font-medium">Error</span>
                    </div>
                  )}
                  <p className="text-sm">{message.content}</p>
                  
                  {/* Metadata */}
                  {message.type === 'bot' && message.metadata && (
                    <div className="mt-2 pt-2 border-t border-gray-200">
                      <button
                        onClick={() => toggleMetadata(message.id)}
                        className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-800"
                      > 
                        <Info className="w-3 h-3" />
                        <span>{showMetadata[message.id] ? 'Hide' : 'Show'} sources ({message.metadata.sources.length})</span>
                      </button>
                      
                      {showMetadata[message.id] && (
                        <div className="mt-2 space-y-1">
                          {message.metadata.sources.map((source, index) => (
                            <div key={index} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-100 p-2 rounded">
                              {source.type === 'web' ? (
                                <>
                                  <Globe className="w-3 h-3 flex-shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium">{source.title}</div>
                                    <a 
                                      href={source.link || source.name} 
                                      target="_blank" 
                                      rel="noopener noreferrer" 
                                      className="truncate text-xs text-blue-600 hover:text-blue-800 hover:underline"
                                    >
                                      {source.name}
                                    </a>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <FileText className="w-3 h-3 flex-shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium">{source.title}</div>
                                    <div className="truncate text-xs text-gray-500">
                                      {source.name} • Page {source.pageNumber}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
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
                  <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
            ))}
            
            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-white p-3 rounded-lg border border-gray-200">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* File attachments preview */}
          {attachedFiles.length > 0 && (
            <div className="px-4 py-2 border-t bg-gray-50">
              <div className="flex flex-wrap gap-2">
                {attachedFiles.map((file, index) => (
                  <div key={index} className="flex items-center gap-2 bg-blue-100 text-blue-800 px-2 py-1 rounded-md text-xs">
                    <FileText className="w-3 h-3" />
                    <span>{file.name}</span>
                    {uploadProgress[file.name] !== undefined && uploadProgress[file.name] < 100 && (
                      <span>({uploadProgress[file.name]}%)</span>
                    )}
                    <button
                      onClick={() => removeFile(index)}
                      className="hover:bg-blue-200 rounded-full p-0.5"
                      disabled={uploadProgress[file.name] !== undefined && uploadProgress[file.name] < 100}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="border-t p-4 bg-white">
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={
                    selectedMode === 'pdf'
                      ? hasUploadedFiles || attachedFiles.length > 0 
                        ? "Ask a question about your uploaded documents..."
                        : "Upload PDF files first, then ask questions about them..."
                      : "Search for academic information on the web..."
                  }
                  className="w-full min-h-[60px] p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
              </div>
              <div className="flex gap-2 mb-2">
                {selectedMode === 'pdf' && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="h-10 w-10 bg-gray-200 hover:bg-gray-300 rounded-lg flex items-center justify-center transition-colors"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={handleSendMessage}
                  disabled={(!inputValue.trim() && attachedFiles.length === 0) || isLoading}
                  className="h-10 w-10 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg flex items-center justify-center transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

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
  );
};

export default ChatInterface;