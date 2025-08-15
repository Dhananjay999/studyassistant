from fastapi import APIRouter, HTTPException, status, Request, Header
from typing import List, Optional
from ..models.schemas import UserChatRequest, ChatResponse, ErrorResponse, UserID
from ..services.chat_service import ChatService

router = APIRouter(prefix="/chat", tags=["Chat"])

# Initialize service
chat_service = ChatService()

@router.post("/", response_model=ChatResponse)
async def chat_endpoint(
    chat_request: UserChatRequest,
    user_id: UserID = Header(..., alias="user-id", description="User ID for chat session")
):
    """Process chat requests"""
    try:
        if not chat_request.message.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Message cannot be empty"
            )
        
        response = chat_service.process_chat_request(request=chat_request,user_id=user_id)
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