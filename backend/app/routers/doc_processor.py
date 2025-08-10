from fastapi import APIRouter, status,HTTPException,UploadFile ,File



from typing import List



router = APIRouter(
    prefix="/upload",
    tags=["File Upload"]
)

def get_deps():
    from ..logics import data_processor, upload_doc 
    return data_processor, upload_doc 

@router.post('/')
def upload_doc_router(file:List[UploadFile]=File(...)):
    if not file:
        raise HTTPException(status_code=status.HTTP_204_NO_CONTENT, detail="Please upload file")
    else:
        data_processor,upload_doc = get_deps()
        return upload_doc.upload_doc(file),data_processor.chunk_embed_store(data_processor.chunk_size,data_processor.parse_doc(upload_doc.doc_directory))
    
