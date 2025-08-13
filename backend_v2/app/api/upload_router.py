from fastapi import APIRouter, HTTPException, status, UploadFile, File
from typing import List
from ..models.schemas import UploadResponse, ErrorResponse
from ..services.upload_service import UploadService

router = APIRouter(prefix="/upload", tags=["File Upload"])

# Initialize service
upload_service = UploadService()

@router.post("/", response_model=UploadResponse)
async def upload_documents(files: List[UploadFile] = File(...)):
    """Upload and process PDF documents"""
    try:
        if not files:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No files provided"
            )
        
        # Validate file types
        for file in files:
            if not file.filename.lower().endswith('.pdf'):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid file type: {file.filename}. Only PDF files are allowed."
                )
        
        response = upload_service.process_uploaded_files(files)
        return response
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing files: {str(e)}"
        )

@router.get("/stats")
async def get_upload_stats():
    """Get upload service statistics"""
    try:
        stats = upload_service.get_upload_stats()
        return stats
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving stats: {str(e)}"
        ) 