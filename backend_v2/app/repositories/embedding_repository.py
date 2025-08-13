import chromadb
from sentence_transformers import SentenceTransformer
from typing import List, Dict, Any, Optional
import os
from ..config.settings import settings

class EmbeddingRepository:
    """Repository for managing embeddings in ChromaDB"""
    
    def __init__(self):
        self.client = chromadb.HttpClient(settings.CHROMA_DB_URL)
        self.collection = self.client.get_or_create_collection(name=settings.EMBEDDING_COLLECTION_NAME)
        self.embedding_model = SentenceTransformer(settings.EMBEDDING_MODEL)
    
    def create_embedding(self, text: str) -> List[float]:
        """Create embedding for given text"""
        return self.embedding_model.encode(text).tolist()
    
    def add_documents(self, documents: List[str], ids: List[str], metadatas: List[Dict[str, Any]]) -> None:
        """Add documents with embeddings to ChromaDB"""
        embeddings = [self.create_embedding(doc) for doc in documents]
        self.collection.add(
            documents=documents,
            embeddings=embeddings,
            ids=ids,
            metadatas=metadatas
        )
    
    def search_similar(self, query: str, n_results: int = 5) -> Dict[str, Any]:
        """Search for similar documents"""
        query_embedding = self.create_embedding(query)
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results
        )
        return results
    
    def get_collection_count(self) -> int:
        """Get total number of documents in collection"""
        return self.collection.count()
    
    def delete_collection(self) -> None:
        """Delete the entire collection"""
        self.client.delete_collection(name=settings.EMBEDDING_COLLECTION_NAME)
        self.collection = self.client.get_or_create_collection(name=settings.EMBEDDING_COLLECTION_NAME) 