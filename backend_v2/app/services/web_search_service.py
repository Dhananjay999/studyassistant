import requests
from typing import Dict, Any, List
from ..config.settings import settings

class WebSearchService:
    """Service for performing web searches using Serper API"""
    
    def __init__(self):
        self.api_key = settings.SERPER_API_KEY
        self.search_url = "https://google.serper.dev/search"
        
        if not self.api_key:
            raise ValueError("SERPER_API_KEY not found in environment variables")
    
    def search(self, query: str, max_results: int = 5) -> Dict[str, Any]:
        """Perform web search and return results"""
        headers = {
            "X-API-KEY": self.api_key,
            "Content-Type": "application/json"
        }
        
        params = {"q": query}
        
        try:
            response = requests.post(
                self.search_url, 
                json=params, 
                headers=headers,
                timeout=30
            )
            response.raise_for_status()
            
            results = response.json()
            
            # Extract and format organic results
            organic_results = results.get("organic", [])
            formatted_results = {
                "organic": organic_results[:max_results],
                "total_results": len(organic_results)
            }
            
            return formatted_results
            
        except requests.exceptions.RequestException as e:
            raise Exception(f"Web search failed: {str(e)}")
        except Exception as e:
            raise Exception(f"Error processing web search results: {str(e)}")
    
    def format_search_results_for_context(self, search_results: Dict[str, Any]) -> List[str]:
        """Format search results for use as context"""
        contexts = []
        
        for result in search_results.get("organic", []):
            snippet = result.get("snippet", "")
            if snippet:
                contexts.append(snippet)
        
        return contexts
    
    def format_search_metadata(self, search_results: Dict[str, Any]) -> List[Dict[str, str]]:
        """Format search results metadata"""
        metadata = []
        
        for result in search_results.get("organic", []):
            metadata.append({
                "title": result.get("title", ""),
                "link": result.get("link", ""),
                "source": "web_search"
            })
        
        return metadata 