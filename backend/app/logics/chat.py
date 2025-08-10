import chromadb
from sentence_transformers import SentenceTransformer
from . import chatbot , web_search
from .. import schemas
import os
db_path = os.path.join(os.path.dirname(__file__), "../../chroma_db")
client = chromadb.PersistentClient(path=os.path.abspath(db_path))

embedding_model = SentenceTransformer("multi-qa-MPNET-base-dot-v1")
client = chromadb.PersistentClient(path=db_path)
embeddings_db = client.get_or_create_collection(name="embeddings") # this is the table for storing embeddings





def embedder(text:str):
    return embedding_model.encode(text).tolist()

def relevent_chunks_querier(query_embedding,n_results):
    return embeddings_db.query(query_embeddings=[query_embedding],n_results=n_results)

def final_reply(query: schemas.UserChat):
    print(f"Received query: {query.message}, mode: {query.search_mode}")  # Debug
    
    if query.search_mode == 'study_material':
        result = relevent_chunks_querier(embedder(query.message), query.n_results)
        input_query = schemas.FinalChat(
            ans_mode=query.search_mode,
            original_query=query.message,
            context=result["documents"][0],
            metadata=result["metadatas"][0]
        )
        final_result= chatbot.chatbot(input_query)
        print(f"Final chatbot result: {final_result}")
        return final_result
    
    elif query.search_mode == 'web_search':  # Make sure this condition matches
        print("Doing web search...")  # Debug
        result = web_search.web_search(query.message)
        print(f"Web search result: {result}")  # Debug
        
        input_query = schemas.FinalChat(
            ans_mode=query.search_mode,
            original_query=query.message,
            context=[contxt["snippet"] for contxt in result["organic"][:query.n_results]],
            metadata=[{"title": meta["title"], "link": meta["link"]} for meta in result["organic"][:query.n_results]]
        )
        final_result = chatbot.chatbot(input_query)
        print(f"Final chatbot result: {final_result}")  # Debug
        return final_result
    else:
        return "Invalid search mode please use either 'study_material' or 'web_search'"