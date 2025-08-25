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

    # ChromaDB Configuration
    CHROMA_DB_API_KEY: str = os.getenv("CHROMA_DB_API_KEY", "")
    CHROMA_DB_TENANT: str = os.getenv("CHROMA_DB_TENANT", "")
    CHROMA_DB_DATABASE: str = os.getenv("CHROMA_DB_DATABASE", "")
    CHROMA_DB_HOST: str = os.getenv("CHROMA_DB_HOST", "api.trychroma.com")
    
    # JWT Configuration
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    
    # Model Configuration
    EMBEDDING_MODEL: str = "multi-qa-MPNET-base-dot-v1"
    CHUNK_SIZE: int = 1000  # Increased for better context
    MAX_CHUNKS_PER_PAGE: int = 10  # Limit chunks per page for large PDFs
    
    # API Keys
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama3-8b-8192")
    SERPER_API_KEY: str = os.getenv("X-API-KEY", "")
    
    # Search Configuration
    MAX_SEARCH_RESULTS: int = 8
    DEFAULT_SEARCH_RESULTS: int = 5
    
    # File Upload Configuration
    MAX_FILE_SIZE: int = 50 * 1024 * 1024  # 50MB (increased for large PDFs)
    ALLOWED_FILE_TYPES: List[str] = [".pdf"]
    
    # Large PDF Processing Configuration
    MAX_PAGES_PER_PDF: int = 1000  # Maximum pages to process
    BATCH_SIZE_FOR_EMBEDDINGS: int = 20  # Smaller batches to prevent timeouts
    EMBEDDING_TIMEOUT: int = 120  # 2 minutes timeout for embedding creation

# Global settings instance
settings = Settings() 