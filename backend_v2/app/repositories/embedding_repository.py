import chromadb
from sentence_transformers import SentenceTransformer
from typing import List, Dict, Any, Optional
import os
from ..config.settings import settings
from ..models.schemas import UserID

class EmbeddingRepository:
    """Repository for managing embeddings in ChromaDB"""

    def __init__(self):
        db_path = os.path.abspath(settings.CHROMA_DB_PATH)
        self.client = chromadb.PersistentClient(path=db_path)
        self.collection = self.client.get_or_create_collection(name=settings.EMBEDDING_COLLECTION_NAME)
        self.embedding_model = SentenceTransformer(settings.EMBEDDING_MODEL)

    def create_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Create embeddings for multiple texts at once (faster)"""
        return self.embedding_model.encode(texts, convert_to_numpy=True).tolist()

    def add_documents(self, documents, ids, metadatas, user_id):
        embeddings = self.create_embeddings(documents)
        unique_ids = [f"{user_id}_{doc_id}" for doc_id in ids]
        user_metadatas = [{**metadata, "user_id": str(user_id)} for metadata in metadatas]

        self.collection.add(
            documents=documents,
            embeddings=embeddings,
            ids=unique_ids,
            metadatas=user_metadatas
        )


    def search_similar(self, query: str, user_id: UserID, n_results: int = 5) -> Dict[str, Any]:
        """Search for similar documents filtered by user_id"""
        query_embedding = self.create_embeddings([query])[0]
        return self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where={"user_id": str(user_id)}
        )
    
    def get_collection_count(self) -> int:
        """Get total number of documents in collection"""
        return self.collection.count()
    
    def delete_collection(self) -> None:
        """Delete the entire collection"""
        self.client.delete_collection(name=settings.EMBEDDING_COLLECTION_NAME)
        self.collection = self.client.get_or_create_collection(name=settings.EMBEDDING_COLLECTION_NAME) 

    def debug_collection_info(self) -> Dict[str, Any]:
        """Debug method to check collection information"""
        try:
            # Get all documents
            all_docs = self.collection.get()
            
            # Count documents per user
            user_counts = {}
            if all_docs.get('metadatas'):
                for metadata in all_docs['metadatas']:
                    if metadata and 'user_id' in metadata:
                        user_id = metadata['user_id']
                        user_counts[user_id] = user_counts.get(user_id, 0) + 1
            
            return {
                "total_documents": len(all_docs.get('ids', [])),
                "users": user_counts,
                "sample_metadata": all_docs.get('metadatas', [])[:3] if all_docs.get('metadatas') else []
            }
        except Exception as e:
            return {"error": str(e)} 