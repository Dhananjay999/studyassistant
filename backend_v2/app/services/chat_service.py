from typing import Dict, Any, List
from ..models.schemas import UserChatRequest, SearchContext, UserID
from ..repositories.embedding_repository import EmbeddingRepository
from ..services.web_search_service import WebSearchService
from ..services.llm_service import LLMService

class ChatService:
    """Main service for handling chat functionality"""
    
    def __init__(self):
        self.embedding_repo = EmbeddingRepository()
        self.web_search_service = WebSearchService()
        self.llm_service = LLMService()
    
    def process_chat_request(self, request: UserChatRequest, user_id: UserID) -> Dict[str, Any]:
        """Process chat request and return response"""
        try:
            if request.search_mode == "study_material":
                return self._handle_study_material_query(request, user_id)
            elif request.search_mode == "web_search":
                return self._handle_web_search_query(request)
            else:
                raise ValueError(f"Invalid search mode: {request.search_mode}")
                
        except Exception as e:
            raise Exception(f"Error processing chat request: {str(e)}")
    
    def _handle_study_material_query(self, request: UserChatRequest, user_id: UserID) -> Dict[str, Any]:
        """Handle study material search using embeddings"""
        # Search for relevant chunks in embeddings
        search_results = self.embedding_repo.search_similar(
            query=request.message, 
            user_id=user_id,
            n_results=request.n_results
        )
        
        # Extract documents and metadata
        documents = search_results.get("documents", [[]])[0]
        metadatas = search_results.get("metadatas", [[]])[0]
        
        if not documents:
            return {
                "answer_source": "study_material",
                "answer": "No relevant study material found. Please upload documents first or try web search mode.",
                "relevant_chunks": [],
                "metadata": []
            }
        
        # Create search context
        context = SearchContext(
            answer_mode=request.search_mode,
            original_query=request.message,
            context=documents,
            metadata=metadatas
        )
        
        # Generate LLM response
        answer = self.llm_service.generate_context_based_response(context)
        return self.llm_service.format_chat_response(answer, context)
    
    def _handle_web_search_query(self, request: UserChatRequest) -> Dict[str, Any]:
        """Handle web search query"""
        # Perform web search

        query_classification = self.llm_service.get_query_classification(request.message)

        if query_classification.value == 'web_search':

            search_results = self.web_search_service.search(
                request.message, 
                request.n_results
            )
        
            # Format results for context
            contexts = self.web_search_service.format_search_results_for_context(search_results)
            metadata = self.web_search_service.format_search_metadata(search_results)
        
            if not contexts:
                return {
                    "answer_source": "web_search",
                    "answer": "No relevant web search results found. Please try rephrasing your query.",
                    "relevant_chunks": [],
                    "metadata": []
                }
            
            # Create search context
            context = SearchContext(
                answer_mode=request.search_mode,
                original_query=request.message,
                context=contexts,
                metadata=metadata
            )
        
            # Generate LLM response
            answer = self.llm_service.generate_context_based_response(context)
            
            return self.llm_service.format_chat_response(answer, context)
        
        else:
            answer = self.llm_service.generate_query_based_response(request.message, query_classification)
            return self.llm_service.format_chat_response(answer)
    
    def get_embedding_stats(self) -> Dict[str, Any]:
        """Get statistics about stored embeddings for a specific user"""
        try:
            count = self.embedding_repo.get_collection_count()
            return {
                "total_documents": count,
                "status": "available" if count > 0 else "empty"
            }
        except Exception as e:
            return {
                "total_documents": 0,
                "status": "error",
                "error": str(e)
            } 