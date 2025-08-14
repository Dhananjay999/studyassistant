from typing import List, Dict
from ..models.schemas import QueryClassification, SearchContext
from ..config.prompts import PROMPT_CONFIG, QUERY_BASED_SYSTEM_PROMPT, QUERY_CLASSIFICATION_SYSTEM_PROMPT

class PromptService:
    """Service for generating prompts for LLM interactions"""
    
    def __init__(self):
        self._prompts = PROMPT_CONFIG.copy()
    
    def build_messages_for_llm(self, context: SearchContext) -> List[Dict[str, str]]:
        """Build complete message list for LLM API call"""
        # Get system prompt based on answer mode
        if context.answer_mode == "study_material":
            system_prompt = self._prompts["study_material_system"]
        elif context.answer_mode == "web_search":
            system_prompt = self._prompts["web_search_system"]
        else:
            raise ValueError(f"Invalid answer mode: {context.answer_mode}. Must be 'study_material' or 'web_search'")
        
        # Format context and question
        context_text = ' '.join(context.context)
        context_prompt = self._prompts["context_format"].format(context=context_text)
        question_prompt = self._prompts["question_format"].format(question=context.original_query)
        
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": context_prompt},
            {"role": "user", "content": question_prompt}
        ]
    
    def build_messages_for_query_based_llm(self, query: str, query_classification: str) -> List[Dict[str, str]]:
        """Build complete message list for LLM API call"""
        system_prompt = QUERY_BASED_SYSTEM_PROMPT(query_classification)
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query}
        ]
    
    def get_query_classification_prompt(self, query: str) -> str:
        """Get query classification"""
        final_prompt = QUERY_CLASSIFICATION_SYSTEM_PROMPT(query)
        return final_prompt
 