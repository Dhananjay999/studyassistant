import requests
from typing import Dict, Any, List, Optional
from ..config.settings import settings
from ..models.schemas import QueryClassification, SearchContext
from .prompt_service import PromptService

class LLMService:
    """Service for interacting with Groq LLM API"""
    
    def __init__(self):
        self.api_key = settings.GROQ_API_KEY
        self.model = settings.GROQ_MODEL
        self.api_url = "https://api.groq.com/openai/v1/chat/completions"
        self.prompt_service = PromptService()
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        if not self.api_key:
            raise ValueError("GROQ_API_KEY not found in environment variables")
    
    def generate_context_based_response(self, context: SearchContext) -> str:
        """Generate response using LLM based on context"""
        
        # Use prompt service to build messages
        messages = self.prompt_service.build_messages_for_llm(context)
        return self.call_llm(messages)
    
    def generate_query_based_response(self, query: str, query_classification: QueryClassification) -> str:
        """Generate response using LLM based on query"""
        messages = self.prompt_service.build_messages_for_query_based_llm(query, query_classification.value)
        print('messages------->', messages)
        return self.call_llm(messages)
    
    def format_chat_response(self, answer: str, context: Optional[SearchContext] = None,) -> Dict[str, Any]:
        """Create formatted chat response"""
        return {
            "answer_source": context.answer_mode if context else 'web_search',
            "answer": answer,
            "relevant_chunks": context.context if context else [],
            "metadata": context.metadata if context else []
        } 
    
    def get_query_classification(self, query: str) -> QueryClassification:
        """Get query classification"""
        final_prompt = [
            {"role": "system", "content": self.prompt_service.get_query_classification_prompt(query)},
        ]
        return QueryClassification(self.call_llm(final_prompt))
        
    def call_llm(self, messages: List[Dict[str, str]]) -> str:
        """Call LLM"""

        data = {
            "model": self.model,
            "messages": messages,
            "max_tokens": 1000,
            "temperature": 0.7
        }

        try:
            response = requests.post(
                self.api_url,
                headers=self.headers,
                json=data,
                timeout=60
            )
            response.raise_for_status()
            result = response.json()
            return result["choices"][0]["message"]["content"]
        
        except requests.exceptions.RequestException as e:
            raise Exception(f"Query classification request failed: {str(e)}")
        except KeyError as e:
            raise Exception(f"Unexpected response format from query classification: {str(e)}")
        except Exception as e:
            raise Exception(f"Error generating query classification: {str(e)}")
