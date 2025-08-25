from fastapi import APIRouter, HTTPException, status, Header
from fastapi.responses import StreamingResponse
import json
from ..models.schemas import UserChatRequest, ChatResponse, UserID
from ..services.chat_service import ChatService
from ..services.streaming_service import StreamingService

router = APIRouter(prefix="/chat", tags=["Chat"])

# Initialize services
chat_service = ChatService()
streaming_service = StreamingService()

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

@router.post("/stream")
async def streaming_chat_endpoint(
    chat_request: UserChatRequest,
    user_id: UserID = Header(..., alias="user-id", description="User ID for chat session")
):
    """Stream chat requests using Server-Sent Events"""
    try:
        if not chat_request.message.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Message cannot be empty"
            )
        
        async def generate_stream():
            async for chunk in streaming_service.stream_chat(request=chat_request, user_id=user_id):
                yield f"data: {json.dumps(chunk)}\n\n"
        
        return StreamingResponse(
            generate_stream(),
            media_type="text/plain",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Allow-Methods": "*"
            }
        )
        
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