from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import chat_router, upload_router, auth_router
from app.config.settings import settings
from app.config.database import db_manager

# Create FastAPI app
app = FastAPI(
    title=settings.API_TITLE,
    version=settings.API_VERSION,
    debug=settings.DEBUG
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Include routers
app.include_router(chat_router.router)
app.include_router(upload_router.router)
app.include_router(auth_router.router)


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Aeva Backend V2 - Clean Architecture",
        "version": settings.API_VERSION,
        "status": "running"
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "version": settings.API_VERSION
    }

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on application shutdown"""
    db_manager.close_pool()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG
    ) 