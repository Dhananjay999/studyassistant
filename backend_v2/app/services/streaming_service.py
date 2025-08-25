import json
import aiohttp
from typing import AsyncGenerator, Dict, Any, List
from ..config.settings import settings
from ..models.schemas import UserChatRequest, SearchContext, UserID, QueryClassification
from ..repositories.embedding_repository import EmbeddingRepository
from ..services.web_search_service import WebSearchService
from ..services.llm_service import LLMService
from ..services.prompt_service import PromptService

class StreamingService:
    """Simple streaming service for chat responses"""
    
    def __init__(self):
        self.api_key = settings.GROQ_API_KEY
        self.model = settings.GROQ_MODEL
        self.api_url = "https://api.groq.com/openai/v1/chat/completions"
        self.embedding_repo = EmbeddingRepository()
        self.web_search_service = WebSearchService()
        self.llm_service = LLMService()
        self.prompt_service = PromptService()
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
    
    async def stream_chat(self, request: UserChatRequest, user_id: UserID) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream chat response based on search mode"""
        # Debug logging
        print(f"Starting stream chat for user: {user_id}")
        print(f"Query: {request.message}")
        print(f"Search mode: {request.search_mode}")
        print(f"PDF names: {request.pdf_names}")
        
        try:
            if request.search_mode == "study_material":
                async for chunk in self._stream_study_material(request, user_id):
                    yield chunk
            elif request.search_mode == "web_search":
                async for chunk in self._stream_web_search(request):
                    yield chunk
            else:
                yield {"type": "error", "content": f"Invalid search mode: {request.search_mode}"}
                
        except Exception as e:
            print(f"Error in stream_chat: {str(e)}")
            yield {"type": "error", "content": f"Error: {str(e)}"}
    
    async def _stream_study_material(self, request: UserChatRequest, user_id: UserID) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream study material response"""
        # Get query classification first
        query_classification = self.llm_service.get_query_classification(request.message)
        
        # Search embeddings
        search_results = self.embedding_repo.search_similar(
            query=request.message, 
            user_id=user_id,
            n_results=request.n_results,
            pdf_names=request.pdf_names
        )
        
        documents = search_results.get("documents", [[]])[0]
        metadatas = search_results.get("metadatas", [[]])[0]
        
        # Debug logging
        print(f"Found {len(documents)} documents for study material search")
        for i, (doc, meta) in enumerate(zip(documents, metadatas)):
            print(f"Document {i+1}: {meta.get('doc_name', 'Unknown')} - Page {meta.get('page_number', 'Unknown')}")
            print(f"Content preview: {doc[:200]}...")
        
        if not documents:
            yield {"type": "chunk", "content": "No relevant study material found. Please upload documents first.", "classification": query_classification.value}
            yield {"type": "end", "classification": query_classification.value, "source": "study_material"}
            return
        
        # Create context and stream response
        context = SearchContext(
            answer_mode=request.search_mode,
            original_query=request.message,
            context=documents,
            metadata=metadatas
        )
        
        async for chunk in self._stream_llm_response(context, query_classification.value):
            yield chunk
        
        yield {"type": "end", "classification": query_classification.value, "source": metadatas}
    
    async def _stream_web_search(self, request: UserChatRequest) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream web search response"""
        # Get query classification
        query_classification = self.llm_service.get_query_classification(request.message)
        
        if query_classification.value == 'web_search':
            # Perform web search
            search_results = self.web_search_service.search(request.message, request.n_results)
            contexts = self.web_search_service.format_search_results_for_context(search_results)
            metadata = self.web_search_service.format_search_metadata(search_results)
            
            # Debug logging
            print(f"Found {len(contexts)} web search contexts")
            for i, (context, meta) in enumerate(zip(contexts, metadata)):
                print(f"Web result {i+1}: {meta.get('title', 'Unknown')}")
                print(f"Content preview: {context[:200]}...")
            
            if not contexts:
                yield {"type": "chunk", "content": "No relevant web search results found.", "classification": query_classification.value}
                yield {"type": "end", "classification": query_classification.value, "source": "web_search"}
                return
            
            # Create context and stream response
            context = SearchContext(
                answer_mode=request.search_mode,
                original_query=request.message,
                context=contexts,
                metadata=metadata
            )
            
            async for chunk in self._stream_llm_response(context, query_classification.value):
                yield chunk
            
            yield {"type": "end", "classification": query_classification.value, "source": metadata}
        else:
            # Stream query-based response
            async for chunk in self._stream_query_response(request.message, query_classification):
                yield chunk
            
            yield {"type": "end", "classification": query_classification.value, "source": []}
    
    async def _stream_llm_response(self, context: SearchContext, classification: str = None) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream LLM response with context"""
        # Debug logging
        print(f"Streaming LLM response with {len(context.context)} context chunks")
        print(f"Classification: {classification or context.answer_mode}")
        
        messages = self.prompt_service.build_messages_for_llm(context)
        async for content in self._call_streaming_llm(messages):
            yield {"type": "chunk", "content": content, "classification": classification or context.answer_mode}
    
    async def _stream_query_response(self, query: str, classification: QueryClassification) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream query-based response"""
        # Debug logging
        print(f"Streaming query-based response for: {query[:100]}...")
        print(f"Classification: {classification.value}")
        
        messages = self.prompt_service.build_messages_for_query_based_llm(query, classification.value)
        async for content in self._call_streaming_llm(messages):
            yield {"type": "chunk", "content": content, "classification": classification.value}
    
    async def _call_streaming_llm(self, messages: List[Dict[str, str]]) -> AsyncGenerator[str, None]:
        """Call LLM with streaming"""
        data = {
            "model": self.model,
            "messages": messages,
            "max_tokens": 1000,
            "temperature": 0.7,
            "stream": True
        }
        
        try:
            # Create SSL context that bypasses certificate verification for development
            import ssl
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            
            connector = aiohttp.TCPConnector(ssl=ssl_context)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.post(
                    self.api_url,
                    headers=self.headers,
                    json=data,
                    timeout=aiohttp.ClientTimeout(total=60)
                ) as response:
                    response.raise_for_status()
                    
                    async for line in response.content:
                        line = line.decode('utf-8').strip()
                        
                        if line.startswith('data: '):
                            data_str = line[6:]
                            
                            if data_str == '[DONE]':
                                break
                            
                            try:
                                chunk_data = json.loads(data_str)
                                if 'choices' in chunk_data and len(chunk_data['choices']) > 0:
                                    choice = chunk_data['choices'][0]
                                    if 'delta' in choice and 'content' in choice['delta']:
                                        content = choice['delta']['content']
                                        if content:
                                            yield content
                            except json.JSONDecodeError:
                                continue
                                
        except Exception as e:
            yield f"Error in streaming: {str(e)}"
