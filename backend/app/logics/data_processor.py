# from fastapi import HTTPException,status
# import os , fitz  , chromadb ,spacy
# from sentence_transformers import SentenceTransformer

from fastapi import HTTPException,status
import os, PyPDF2, chromadb, spacy
from sentence_transformers import SentenceTransformer


base_dir = os.path.dirname(os.path.abspath(__file__))  # This file's folder (logics/)
path_db = os.path.abspath(os.path.join(base_dir, "../chroma_db"))  # go up two levels

chunk_size = 250
embedding_model = SentenceTransformer("multi-qa-MPNET-base-dot-v1")
client = chromadb.PersistentClient(path=path_db)
embeddings_db = client.get_or_create_collection(name="embeddings")
english_model = spacy.load("en_core_web_sm")


def parse_doc(url):
    print("parsing documents",url)
    if not url:
        raise HTTPException(status_code=status.HTTP_204_NO_CONTENT,details="Url of the Directory of uploaded files is not provided")
    if not os.listdir(url):
        raise HTTPException(status_code=status.HTTP_204_NO_CONTENT,details ="Please upload pdf files first")
    data =[]
    for filename in os.listdir(url):
        if filename.endswith(".pdf"):
            filePath = os.path.join(url,filename)
            try:
                with open(filePath, 'rb') as file:
                    pdf_reader = PyPDF2.PdfReader(file)
                    for page_number, page in enumerate(pdf_reader.pages):
                        text = page.extract_text()
                        data.append({
                            "page_number": page_number + 1,
                            "context": text,
                            "doc_name": filename
                        })
                print(f"parsing of document {filename} successful")
            except Exception as e:
                print(f"Error parsing {filename}: {str(e)}")
                continue
    else:
        print("all files parsed successfully")
    return data

def is_significant_token(token):
    return(not token.is_punct and not token.is_stop)

def chunk_embed_store(chunk_size,data):
    chunk=""
    filtered_text =""
    chunk_id=1
    for j in data:
        doc = english_model(j["context"])
        for sentence in doc.sents:
            filtered_tokens = [token.text for token in sentence if is_significant_token(token)]
            filtered_text =" ".join(filtered_tokens)
            filtered_text= filtered_text.strip()
            if(len(chunk)+len(sentence)<chunk_size):
                chunk+=filtered_text + " "
                filtered_text =""
            else: 
                embeddings = embedding_model.encode(chunk).tolist()
                embeddings_db.add(documents=[chunk],ids=[str(chunk_id)],embeddings=embeddings,metadatas=[{"page_number": j["page_number"],"doc_name":j["doc_name"]}])
                chunk = filtered_text + " "
                filtered_text=""
                chunk_id +=1
    else:
        embeddings = embedding_model.encode(chunk).tolist()
        embeddings_db.add(documents=[chunk],ids=[str(chunk_id)],embeddings=embeddings,metadatas=[{"page_number": j["page_number"],"doc_name":j["doc_name"]}])
        chunk_id +=1        
        print("chunking , embedding and storing successful")


