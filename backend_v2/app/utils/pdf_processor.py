import PyPDF2
import re
from typing import List
from ..models.schemas import DocumentChunk
from ..config.settings import settings

class PDFProcessor:
    """Utility class for processing PDF files and creating text chunks"""
    
    def __init__(self):
        # Simple text processing without spacy
        pass
    
    def extract_text_from_pdf(self, pdf_file) -> List[DocumentChunk]:
        """Extract text from PDF file and return as chunks with large PDF handling"""
        chunks = []
        
        try:
            pdf_file.file.seek(0)  # Go back to start of file
            pdf_reader = PyPDF2.PdfReader(pdf_file.file)
            
            # Check if PDF is too large
            total_pages = len(pdf_reader.pages)
            if total_pages > settings.MAX_PAGES_PER_PDF:
                raise ValueError(f"PDF too large: {total_pages} pages. Maximum allowed: {settings.MAX_PAGES_PER_PDF}")
            
            print(f"Processing PDF: {pdf_file.filename} with {total_pages} pages")
            
            for page_number, page in enumerate(pdf_reader.pages):
                # Progress indicator for large PDFs
                if page_number % 50 == 0:
                    print(f"Processing page {page_number + 1}/{total_pages}")
                
                text = page.extract_text()
                if text.strip():  # Only process non-empty pages
                    page_chunks = self._create_chunks_from_text(
                        text, 
                        page_number + 1, 
                        pdf_file.filename
                    )
                    chunks.extend(page_chunks)
                    
                    # Limit chunks per page for very large PDFs
                    if len(page_chunks) > settings.MAX_CHUNKS_PER_PAGE:
                        print(f"Warning: Page {page_number + 1} has {len(page_chunks)} chunks, limiting to {settings.MAX_CHUNKS_PER_PAGE}")
                        chunks = chunks[:-len(page_chunks)] + page_chunks[:settings.MAX_CHUNKS_PER_PAGE]
                    
        except Exception as e:
            raise ValueError(f"Error processing PDF file: {str(e)}")
        
        print(f"Total chunks created: {len(chunks)}")
        return chunks
    
    def _create_chunks_from_text(self, text: str, page_number: int, document_name: str) -> List[DocumentChunk]:
        """Create text chunks from raw text using simple sentence splitting"""
        chunks = []
        current_chunk = ""
        
        # Simple sentence splitting using regex
        sentences = re.split(r'[.!?]+', text)
        sentences = [s.strip() for s in sentences if s.strip()]
        
        for sentence in sentences:
            # Simple text cleaning
            cleaned_sentence = self._clean_text(sentence)
            
            if not cleaned_sentence:
                continue
            
            # Check if adding this sentence would exceed chunk size
            if len(current_chunk) + len(cleaned_sentence) < settings.CHUNK_SIZE:
                current_chunk += cleaned_sentence + " "
            else:
                # Save current chunk if it's not empty
                if current_chunk.strip():
                    chunks.append(DocumentChunk(
                        page_number=page_number,
                        content=current_chunk.strip(),
                        document_name=document_name
                    ))
                current_chunk = cleaned_sentence + " "
        
        # Add the last chunk if it's not empty
        if current_chunk.strip():
            chunks.append(DocumentChunk(
                page_number=page_number,
                content=current_chunk.strip(),
                document_name=document_name
            ))
        
        return chunks
    
    def _clean_text(self, text: str) -> str:
        """Clean and filter text"""
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Remove special characters but keep basic punctuation
        text = re.sub(r'[^\w\s\.\,\!\?\;\:\-\(\)]', '', text)
        
        # Filter out very short sentences
        if len(text.strip()) < 10:
            return ""
        
        return text.strip()
    
    def validate_pdf_file(self, file) -> bool:
        """Validate if file is a valid PDF"""
        if not file.filename.lower().endswith('.pdf'):
            return False
        
        # Check file size
        file.file.seek(0, 2)  # Seek to end
        file_size = file.file.tell()
        file.file.seek(0)  # Reset to beginning
        
        if file_size > settings.MAX_FILE_SIZE:
            return False
        
        return True 