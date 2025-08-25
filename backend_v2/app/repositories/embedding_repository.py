import chromadb
from sentence_transformers import SentenceTransformer
from typing import List, Dict, Any, Optional
from ..config.settings import settings
from ..models.schemas import UserID


class EmbeddingRepository:
    """Repository for managing embeddings in ChromaDB"""

    def __init__(self):
        self.client = chromadb.CloudClient(
  api_key='ck-Ebcmu7Zd6LYcRBgzYZ9SyXUzKHw4s9HFtYjNKbMZHTxs',
  tenant='feaddcfe-415a-4309-acc3-ec837bd56d2e',
  database='studyAssistant'
)
        
        self.collection = self.client.get_or_create_collection(
            name=settings.EMBEDDING_COLLECTION_NAME
        )
        self.embedding_model = SentenceTransformer(settings.EMBEDDING_MODEL)

    def create_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Create embeddings for multiple texts at once with timeout handling"""
        import signal
        import time
        
        def timeout_handler(signum, frame):
            raise TimeoutError("Embedding creation timed out")
        
        # Set timeout for embedding creation
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(settings.EMBEDDING_TIMEOUT)
        
        try:
            print(f"Creating embeddings for {len(texts)} texts...")
            start_time = time.time()
            
            embeddings = self.embedding_model.encode(texts, convert_to_numpy=True).tolist()
            
            end_time = time.time()
            print(f"Embeddings created in {end_time - start_time:.2f} seconds")
            
            signal.alarm(0)  # Cancel the alarm
            return embeddings
            
        except TimeoutError:
            signal.alarm(0)  # Cancel the alarm
            raise Exception("Embedding creation timed out. Try with smaller chunks or fewer documents.")
        except Exception as e:
            signal.alarm(0)  # Cancel the alarm
            raise Exception(f"Error creating embeddings: {str(e)}")

    def add_documents(self, documents, ids, metadatas, user_id):
        """Add documents to ChromaDB with batch processing and rollback for large PDFs"""
        print(f"Adding {len(documents)} documents for user {user_id}")
        
        # Process in batches to handle large PDFs
        batch_size = settings.BATCH_SIZE_FOR_EMBEDDINGS
        added_batch_ids = []  # Track successfully added batches for rollback
        
        try:
            for i in range(0, len(documents), batch_size):
                batch_docs = documents[i:i + batch_size]
                batch_ids = ids[i:i + batch_size]
                batch_metadatas = metadatas[i:i + batch_size]
                
                batch_number = i//batch_size + 1
                total_batches = (len(documents) + batch_size - 1)//batch_size
                
                print(f"Processing batch {batch_number}/{total_batches}")
                
                try:
                    # Create embeddings for this batch
                    batch_embeddings = self.create_embeddings(batch_docs)
                    
                    # Create unique IDs and metadata for this batch
                    batch_unique_ids = [f"{user_id}_{doc_id}" for doc_id in batch_ids]
                    batch_user_metadatas = [
                        {**metadata, "user_id": str(user_id)} for metadata in batch_metadatas
                    ]

                    # Add batch to ChromaDB
                    self.collection.add(
                        documents=batch_docs,
                        embeddings=batch_embeddings,
                        ids=batch_unique_ids,
                        metadatas=batch_user_metadatas,
                    )
                    
                    # Track this batch for potential rollback
                    added_batch_ids.extend(batch_unique_ids)
                    
                    print(f"Successfully added batch {batch_number}")
                    
                except Exception as e:
                    print(f"Error processing batch {batch_number}: {str(e)}")
                    # Rollback all previously added batches
                    if added_batch_ids:
                        print(f"Rolling back {len(added_batch_ids)} previously added documents...")
                        self._rollback_documents(added_batch_ids)
                    raise Exception(f"Failed to add documents batch {batch_number}: {str(e)}")
                    
        except Exception as e:
            # Final rollback in case of any other errors
            if added_batch_ids:
                print(f"Final rollback: removing {len(added_batch_ids)} documents...")
                self._rollback_documents(added_batch_ids)
            raise e
    
    def _rollback_documents(self, document_ids: List[str]):
        """Rollback/remove documents by their IDs"""
        try:
            if document_ids:
                self.collection.delete(ids=document_ids)
                print(f"Successfully rolled back {len(document_ids)} documents")
        except Exception as e:
            print(f"Warning: Failed to rollback documents: {str(e)}")
            # Don't raise here as we're already in an error state

    def search_similar(
        self, query: str, user_id: UserID, n_results: int = 5, pdf_names: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Search for similar documents filtered by user_id and optionally by specific PDF names"""
        try:
            print(f"Searching for query: '{query[:50]}...' with {n_results} results")
            
            query_embedding = self.create_embeddings([query])[0]
            
            # Build where clause
            where_clause = {"user_id": str(user_id)}
            
            # If PDF names are specified, filter by them
            if pdf_names and len(pdf_names) > 0:
                where_clause = {
                    "$and": [
                        {"user_id": str(user_id)},
                        {"doc_name": {"$in": pdf_names}}
                    ]
                }
                print(f"Filtering by PDF names: {pdf_names}")

            print(f"Where clause: {where_clause}")
            
            # Limit results to prevent memory issues
            max_results = min(n_results, settings.MAX_SEARCH_RESULTS)
            
            result = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=max_results,
                where=where_clause,
            )
            
            print(f"Found {len(result.get('documents', [[]])[0])} results")
            return result
            
        except Exception as e:
            print(f"Error in search_similar: {str(e)}")
            raise Exception(f"Search failed: {str(e)}")

    def get_collection_count(self) -> int:
        """Get total number of documents in collection"""
        return self.collection.count()

    def delete_collection(self) -> None:
        """Delete the entire collection"""
        self.client.delete_collection(name=settings.EMBEDDING_COLLECTION_NAME)
        self.collection = self.client.get_or_create_collection(
            name=settings.EMBEDDING_COLLECTION_NAME
        )

    def debug_collection_info(self) -> Dict[str, Any]:
        """Debug method to check collection information"""
        try:
            # Get all documents
            all_docs = self.collection.get()

            # Count documents per user
            user_counts = {}
            if all_docs.get("metadatas"):
                for metadata in all_docs["metadatas"]:
                    if metadata and "user_id" in metadata:
                        user_id = metadata["user_id"]
                        user_counts[user_id] = user_counts.get(user_id, 0) + 1

            return {
                "total_documents": len(all_docs.get("ids", [])),
                "users": user_counts,
                "sample_metadata": all_docs.get("metadatas", [])[:3]
                if all_docs.get("metadatas")
                else [],
            }
        except Exception as e:
            return {"error": str(e)}

    def get_file_names_by_user_id(self, user_id: UserID) -> List[str]:
        """Get list of unique file names for a specific user"""
        try:
            # Get all documents for the specific user
            all_docs = self.collection.get(where={"user_id": str(user_id)})

            # Extract unique file names from metadata
            file_names = set()
            if all_docs.get("metadatas"):
                for metadata in all_docs["metadatas"]:
                    if metadata and "doc_name" in metadata:
                        file_names.add(metadata["doc_name"])

            return sorted(list(file_names))
        except Exception as e:
            raise Exception(f"Error retrieving file names for user {user_id}: {str(e)}")

    def delete_file_by_user_id(self, user_id: UserID, file_name: str) -> int:
        """Delete all embeddings for a specific file of a user"""
        try:
            # Get all documents for the specific user and file
            all_docs = self.collection.get(
                where={"$and": [{"user_id": str(user_id)}, {"doc_name": file_name}]}
            )

            if not all_docs.get("ids"):
                return 0  # No documents found

            # Delete the documents by their IDs
            self.collection.delete(ids=all_docs["ids"])
            
            print(f"Deleted {len(all_docs['ids'])} embeddings for file {file_name}")

            return len(all_docs["ids"])
        except Exception as e:
            raise Exception(
                f"Error deleting file {file_name} for user {user_id}: {str(e)}"
            )
    
    def delete_file_by_user_id_silent(self, user_id: UserID, file_name: str) -> int:
        """Delete all embeddings for a specific file of a user without raising exceptions"""
        try:
            return self.delete_file_by_user_id(user_id, file_name)
        except Exception as e:
            print(f"Warning: Failed to delete file {file_name} for user {user_id}: {str(e)}")
            return 0

    def delete_all_files_by_user_id(self, user_id: UserID) -> int:
        """Delete all embeddings for a specific user"""
        try:
            # Get all documents for the specific user
            all_docs = self.collection.get(where={"user_id": str(user_id)})

            if not all_docs.get("ids"):
                return 0  # No documents found

            # Delete the documents by their IDs
            self.collection.delete(ids=all_docs["ids"])

            return len(all_docs["ids"])
        except Exception as e:
            raise Exception(f"Error deleting all files for user {user_id}: {str(e)}")
