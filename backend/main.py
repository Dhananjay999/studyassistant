from fastapi import FastAPI
from backend.routers import doc_processor, chatbot
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()



# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://localhost:3000"],  # Your frontend URLs
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


app.include_router(doc_processor.router)
app.include_router(chatbot.router)
