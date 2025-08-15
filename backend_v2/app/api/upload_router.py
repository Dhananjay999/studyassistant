from fastapi import APIRouter, HTTPException, status, UploadFile, File, Request, Header, Query
from typing import List, Optional
from ..models.schemas import UploadResponse, ErrorResponse, UserID, FileListResponse, DeleteFileResponse, DeleteAllFilesResponse
from ..services.upload_service import UploadService

router = APIRouter(prefix="/upload", tags=["File Upload"])

# Initialize service
upload_service = UploadService()

@router.post("/", response_model=UploadResponse)
async def upload_documents(
    files: List[UploadFile] = File(...),
    user_id: UserID = Header(..., alias="user-id", description="User ID for document ownership")
):
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
        
        response = upload_service.process_uploaded_files(files, user_id)
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
    
@router.get("/delete")
async def delete_collection():
    """Delete the entire collection"""
    try:
        upload_service.delete_collection()
        return {"message": "Collection deleted successfully"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting collection: {str(e)}"
        )  

@router.get("/debug")
async def debug_collection():
    """Debug endpoint to check collection information"""
    try:
        debug_info = upload_service.embedding_repo.debug_collection_info()
        return debug_info
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error getting debug info: {str(e)}"
        )

@router.get("/files/{user_id}", response_model=FileListResponse)
async def get_user_files(user_id: UserID):
    """Get list of file names for a specific user"""
    try:
        file_names = upload_service.get_file_names_by_user_id(user_id)
        return FileListResponse(
            user_id=user_id,
            file_names=file_names,
            total_files=len(file_names)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving files for user {user_id}: {str(e)}"
        )

@router.delete("/files", response_model=DeleteFileResponse)
async def delete_user_file(
    file_name: str = Query(..., description="Name of the file to delete"),
    user_id: UserID = Header(..., alias="user-id", description="User ID for document ownership")
):
    """Delete a specific file for a user"""
    try:
        chunks_deleted = upload_service.delete_file_by_user_id(user_id, file_name)
        return DeleteFileResponse(
            user_id=user_id,
            file_name=file_name,
            chunks_deleted=chunks_deleted,
            message=f"Successfully deleted {chunks_deleted} chunks for file '{file_name}'"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting file '{file_name}' for user {user_id}: {str(e)}"
        )

@router.delete("/files/all", response_model=DeleteAllFilesResponse)
async def delete_all_user_files(
    user_id: UserID = Header(..., alias="user-id", description="User ID for document ownership")
):
    """Delete all files for a user"""
    try:
        chunks_deleted = upload_service.delete_all_files_by_user_id(user_id)
        return DeleteAllFilesResponse(
            user_id=user_id,
            chunks_deleted=chunks_deleted,
            message=f"Successfully deleted {chunks_deleted} chunks for all files"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting all files for user {user_id}: {str(e)}"
        ) 