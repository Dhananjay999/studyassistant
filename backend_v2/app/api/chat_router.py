from fastapi import APIRouter, HTTPException, status
from typing import List
from ..models.schemas import UserChatRequest, ChatResponse, ErrorResponse
from ..services.chat_service import ChatService

router = APIRouter(prefix="/chat", tags=["Chat"])

# Initialize service
chat_service = ChatService()

@router.post("/", response_model=ChatResponse)
async def chat_endpoint(request: UserChatRequest):
    """Process chat requests"""
    try:
        if not request.message.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Message cannot be empty"
            )
        
        response = chat_service.process_chat_request(request)
        return ChatResponse(**response)
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )

@router.get("/stats")
async def get_chat_stats():
    """Get chat service statistics"""
    try:
        stats = chat_service.get_embedding_stats()
        return stats
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving stats: {str(e)}"
        ) 