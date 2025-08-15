from typing import List, Dict, Any, Optional
from fastapi import UploadFile
from ..models.schemas import UploadResponse, UserID
from ..utils.pdf_processor import PDFProcessor
from ..repositories.embedding_repository import EmbeddingRepository

class UploadService:
    """Service for handling document uploads and processing"""
    
    def __init__(self):
        self.pdf_processor = PDFProcessor()
        self.embedding_repo = EmbeddingRepository()
    
    def process_uploaded_files(self, files: List[UploadFile], user_id: UserID) -> UploadResponse:
        """Process uploaded PDF files and store embeddings"""
        if not files:
            raise ValueError("No files provided")
        
        total_chunks = 0
        processed_files = 0
        
        for file in files:
            try:
                # Validate file
                if not self.pdf_processor.validate_pdf_file(file):
                    raise ValueError(f"Invalid file: {file.filename}. Only PDF files under 10MB are allowed.")
                
                # Process PDF and extract chunks
                chunks = self.pdf_processor.extract_text_from_pdf(file)
                
                if not chunks:
                    continue  # Skip files with no content
                
                # Prepare data for embedding storage
                documents = [chunk.content for chunk in chunks]
                ids = [f"{file.filename}_{i}_{chunk.page_number}" for i, chunk in enumerate(chunks)]
                metadatas = [
                    {
                        "page_number": chunk.page_number,
                        "doc_name": chunk.document_name,
                        "source": "uploaded_pdf"
                    } for chunk in chunks
                ]
                
                # Store embeddings
                self.embedding_repo.add_documents(documents=documents, ids=ids, metadatas=metadatas, user_id=user_id)
                
                total_chunks += len(chunks)
                processed_files += 1
                
            except Exception as e:
                raise Exception(f"Error processing file {file.filename}: {str(e)}")
        
        return UploadResponse(
            message=f"Successfully processed {processed_files} files",
            files_processed=processed_files,
            chunks_created=total_chunks
        )
    
    def get_upload_stats(self) -> Dict[str, Any]:
        """Get statistics about uploaded documents for a specific user"""
        try:
            count = self.embedding_repo.get_collection_count()
            return {
                "total_chunks": count,
                "status": "available" if count > 0 else "empty"
            }
        except Exception as e:
            return {
                "total_chunks": 0,
                "status": "error",
                "error": str(e)
            } 
    
    def delete_collection(self) -> None:
        """Delete the entire collection"""
        self.embedding_repo.delete_collection()
    
    def get_file_names_by_user_id(self, user_id: UserID) -> List[str]:
        """Get list of file names for a specific user"""
        try:
            return self.embedding_repo.get_file_names_by_user_id(user_id)
        except Exception as e:
            raise Exception(f"Error retrieving file names for user {user_id}: {str(e)}")
    
    def delete_file_by_user_id(self, user_id: UserID, file_name: str) -> int:
        """Delete all embeddings for a specific file of a user"""
        try:
            return self.embedding_repo.delete_file_by_user_id(user_id, file_name)
        except Exception as e:
            raise Exception(f"Error deleting file {file_name} for user {user_id}: {str(e)}")
    
    def delete_all_files_by_user_id(self, user_id: UserID) -> int:
        """Delete all embeddings for a specific user"""
        try:
            return self.embedding_repo.delete_all_files_by_user_id(user_id)
        except Exception as e:
            raise Exception(f"Error deleting all files for user {user_id}: {str(e)}")