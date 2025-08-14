import { 
  APIMetadata, 
  PDFMetadata, 
  SourceInfo, 
  MessageIdGenerator, 
  MetadataMapper, 
  PDFMetadataGuard 
} from "@/types/chat";

// Utility functions
export const createMessageId: MessageIdGenerator = (): string => Date.now().toString();

export const isPDFMetadata: PDFMetadataGuard = (meta: APIMetadata): meta is PDFMetadata => {
  return meta.source === 'uploaded_pdf';
};

export const mapAPIMetadataToSourceInfo: MetadataMapper = (meta: APIMetadata): SourceInfo => {
  if (isPDFMetadata(meta)) {
    return {
      name: meta.doc_name || 'Unknown PDF',
      pageNumber: meta.page_number,
      title: `${meta.doc_name || 'PDF'} - Page ${meta.page_number || 'Unknown'}`,
      type: 'pdf'
    };
  } else {
    return {
      name: meta.link || 'Unknown web source',
      title: meta.title || 'Web source',
      type: 'web'
    };
  }
};

// Validation utilities
export const isValidMessage = (content: string): boolean => {
  return content.trim().length > 0;
};

export const isValidFile = (file: File): boolean => {
  console.log('Validating file:', file.name, file.type, file.size);
  // Check if it's a PDF file (either by MIME type or file extension)
  const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const hasSize = file.size > 0;
  console.log('File validation result:', { isPDF, hasSize, fileName: file.name });
  return isPDF && hasSize;
}; 