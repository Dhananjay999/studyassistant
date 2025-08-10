from fastapi import FastAPI
from routers import doc_processor, chatbot
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

app = FastAPI()

# Get CORS origins from environment or use defaults
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:8080,http://localhost:3000").split(",")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,  # Your frontend URLs
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


app.include_router(doc_processor.router)
app.include_router(chatbot.router)
