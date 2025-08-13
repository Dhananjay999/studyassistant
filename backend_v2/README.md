# Aeva Backend V2 - Clean Architecture

A modern, scalable backend implementation for the Aeva application following clean architecture principles and SOLID design patterns.

## Features

- **Document Processing**: Upload PDF files and extract embeddings
- **Semantic Search**: Search through uploaded documents using vector similarity
- **Web Search**: Perform web searches using Serper API
- **LLM Integration**: Generate responses using Groq LLM API
- **Prompt Management**: Centralized prompt service for easy customization
- **Clean Architecture**: Modular, maintainable code structure
- **Type Safety**: Full TypeScript-like type hints with Pydantic
- **Error Handling**: Comprehensive error handling and validation

## Architecture

```
backend_v2/
├── app/
│   ├── config/         # Configuration and settings
│   ├── models/         # Pydantic schemas and data models
│   ├── services/       # Business logic services
│   ├── repositories/   # Data access layer
│   ├── api/           # FastAPI routes and controllers
│   └── utils/         # Utility functions and helpers
├── main.py            # Application entry point
└── requirements.txt   # Python dependencies
```

## API Endpoints

### Chat Endpoints
- `POST /chat/` - Process chat requests
- `GET /chat/stats` - Get chat service statistics

### Upload Endpoints
- `POST /upload/` - Upload and process PDF documents
- `GET /upload/stats` - Get upload service statistics



### System Endpoints
- `GET /` - Root endpoint
- `GET /health` - Health check

## Setup

1. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Install Spacy Model**:
   ```bash
   python -m spacy download en_core_web_sm
   ```

3. **Environment Variables**:
   Create a `.env` file with:
   ```
   GROQ_API_KEY=your_groq_api_key
   X-API-KEY=your_serper_api_key
   DEBUG=False
   ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080
   ```

4. **Run the Application**:
   ```bash
   python main.py
   ```

## Usage

### Upload Documents
```bash
curl -X POST "http://localhost:8000/upload/" \
  -H "Content-Type: multipart/form-data" \
  -F "files=@document.pdf"
```

### Chat with Study Material
```bash
curl -X POST "http://localhost:8000/chat/" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is machine learning?",
    "search_mode": "study_material",
    "n_results": 5
  }'
```

### Chat with Web Search
```bash
curl -X POST "http://localhost:8000/chat/" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Latest AI developments",
    "search_mode": "web_search",
    "n_results": 5
  }'
```



## Key Improvements Over V1

1. **Clean Architecture**: Clear separation of concerns
2. **Prompt Management**: Dedicated PromptService with configuration file for easy customization
3. **Type Safety**: Comprehensive type hints and validation
4. **Error Handling**: Proper HTTP status codes and error messages
5. **Modularity**: Each component has a single responsibility
6. **Scalability**: Easy to extend and maintain
7. **Documentation**: Auto-generated API docs with FastAPI
8. **Configuration**: Centralized settings management
9. **Testing Ready**: Structure supports easy unit testing

## Dependencies

- **FastAPI**: Modern web framework
- **ChromaDB**: Vector database for embeddings
- **SentenceTransformers**: Text embedding models
- **PyPDF2**: PDF processing
- **Spacy**: Natural language processing
- **Groq API**: LLM service
- **Serper API**: Web search service

## Development

The codebase follows these principles:
- **SOLID Principles**: Single responsibility, open/closed, etc.
- **Dependency Injection**: Services are injected where needed
- **Repository Pattern**: Data access is abstracted
- **Service Layer**: Business logic is separated from API layer
- **Configuration Management**: Environment-based settings 