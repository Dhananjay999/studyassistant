from enum import Enum
from typing_extensions import Literal
from pydantic import BaseModel, Field, field_validator
from typing import List, Dict, Any, Optional

class UserChatRequest(BaseModel):
    """User chat request model"""
    message: str = Field(..., description="User's query message")
    n_results: int = Field(default=5, description="Number of results to return")
    search_mode: str = Field(default="study_material", description="Search mode: study_material or web_search")
    
    @field_validator('n_results')
    def validate_n_results(cls, v):
        if v > 8:
            raise ValueError("n_results cannot be greater than 8")
        if v < 1:
            raise ValueError("n_results must be at least 1")
        return v
    
    @field_validator('search_mode')
    def validate_search_mode(cls, v):
        allowed_modes = ['study_material', 'web_search']
        if v not in allowed_modes:
            raise ValueError(f"search_mode must be one of: {allowed_modes}")
        return v

class ChatResponse(BaseModel):
    """Chat response model"""
    answer_source: str = Field(..., description="Source of the answer")
    answer: str = Field(..., description="Generated answer")
    relevant_chunks: List[str] = Field(..., description="Relevant context chunks")
    metadata: List[Dict[str, Any]] = Field(..., description="Metadata for sources")

class UploadResponse(BaseModel):
    """File upload response model"""
    message: str = Field(..., description="Upload status message")
    files_processed: int = Field(..., description="Number of files processed")
    chunks_created: int = Field(..., description="Number of chunks created")

class ErrorResponse(BaseModel):
    """Error response model"""
    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(None, description="Additional error details")

# Internal models for processing
class DocumentChunk(BaseModel):
    """Internal model for document chunks"""
    page_number: int
    content: str
    document_name: str

class SearchContext(BaseModel):
    """Internal model for search context"""
    answer_mode: str
    original_query: str
    context: List[str]
    metadata: List[Dict[str, Any]] 

class QueryClassification(Enum):
    STUDY = "study"
    WEB_SEARCH = "web_search"
    MODERATION = "moderation"
    MISC = "misc"
    SORRY = "sorry"