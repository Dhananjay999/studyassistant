from pydantic import BaseModel , field_validator
from typing import Dict, Union



class UserChat(BaseModel):
    message: str
    n_results:int = 5
    search_mode :str = 'study_material' # it can be plain llm it can be websearch it can be from uploaded pdf
    

    @field_validator('n_results')
    def max_relevant_chunks(cls,n_results): # yaha pe cls isiliye bcs instance banane se pahle check kar rahe
        if n_results>8:
            raise ValueError("n_result cannot be greater than 3")
        
        return n_results
    # @field_validator('search_mode')
    # def study_material_checker(cls,search_mode):
    #     need to check if the user has uploaded file or not 
    



class FinalChat(BaseModel):
    ans_mode: str
    original_query: str
    context: list
    metadata:list