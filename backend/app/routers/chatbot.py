from fastapi import APIRouter, status,HTTPException,UploadFile ,File
from .. import schemas

router = APIRouter(
    prefix="/chat",
    tags=["Chat"]
)

# this is known as laszy startup

def get_deps(): 
    from .. logics import chat
    return chat

@router.post('/')
def upload_doc_router(query : schemas.UserChat):
    if not query:
        raise HTTPException(status_code=status.HTTP_204_NO_CONTENT, detail="Please enter your query")
    chat = get_deps()
    return chat.final_reply(query)
        
