import requests
from typing import Dict, Any, List
from ..config.settings import settings
from ..models.schemas import SearchContext
from .prompt_service import PromptService

class LLMService:
    """Service for interacting with Groq LLM API"""
    
    def __init__(self):
        self.api_key = settings.GROQ_API_KEY
        self.model = settings.GROQ_MODEL
        self.api_url = "https://api.groq.com/openai/v1/chat/completions"
        self.prompt_service = PromptService()
        
        if not self.api_key:
            raise ValueError("GROQ_API_KEY not found in environment variables")
    
    def generate_response(self, context: SearchContext) -> str:
        """Generate response using LLM based on context"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        # Use prompt service to build messages
        messages = self.prompt_service.build_messages_for_llm(context)
        
        data = {
            "model": self.model,
            "messages": messages,
            "max_tokens": 1000,
            "temperature": 0.7
        }
        
        try:
            response = requests.post(
                self.api_url,
                headers=headers,
                json=data,
                timeout=60
            )
            response.raise_for_status()
            
            result = response.json()
            return result["choices"][0]["message"]["content"]
            
        except requests.exceptions.RequestException as e:
            raise Exception(f"LLM API request failed: {str(e)}")
        except KeyError as e:
            raise Exception(f"Unexpected response format from LLM API: {str(e)}")
        except Exception as e:
            raise Exception(f"Error generating LLM response: {str(e)}")
    
    def create_chat_response(self, context: SearchContext, answer: str) -> Dict[str, Any]:
        """Create formatted chat response"""
        return {
            "answer_source": context.answer_mode,
            "answer": answer,
            "relevant_chunks": context.context,
            "metadata": context.metadata
        } 