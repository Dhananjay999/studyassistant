import os
from typing import List
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class Settings:
    """Application settings and configuration"""
    
    # API Configuration
    API_TITLE: str = "Aeva Backend V2"
    API_VERSION: str = "2.0.0"
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"
    
    # CORS Configuration
    ALLOWED_ORIGINS: List[str] = os.getenv(
        "ALLOWED_ORIGINS", 
        "http://localhost:8080,http://localhost:3000"
    ).split(",")
    
    # Database Configuration
    CHROMA_DB_PATH: str = os.path.join(os.path.dirname(__file__), "../../chroma_db")
    EMBEDDING_COLLECTION_NAME: str = "embeddings"
    
    # PostgreSQL Database Configuration
    DB_HOST: str = os.getenv("DB_HOST", "aws-1-ap-southeast-1.pooler.supabase.com")
    DB_NAME: str = os.getenv("DB_NAME", "postgres")
    DB_USER: str = os.getenv("DB_USER", "postgres.kpyhigcqxrhliiyeteiv")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
    DB_PORT: str = os.getenv("DB_PORT", "6543")
    
    # JWT Configuration
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    
    # Model Configuration
    EMBEDDING_MODEL: str = "multi-qa-MPNET-base-dot-v1"
    CHUNK_SIZE: int = 250
    
    # API Keys
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama3-8b-8192")
    SERPER_API_KEY: str = os.getenv("X-API-KEY", "")
    
    # Search Configuration
    MAX_SEARCH_RESULTS: int = 8
    DEFAULT_SEARCH_RESULTS: int = 5
    
    # File Upload Configuration
    MAX_FILE_SIZE: int = 10 * 1024 * 1024  # 10MB
    ALLOWED_FILE_TYPES: List[str] = [".pdf"]

# Global settings instance
settings = Settings() 