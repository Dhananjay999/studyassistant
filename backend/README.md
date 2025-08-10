# Aeva Backend API

A FastAPI-based backend service for an intelligent chatbot system that supports document processing, semantic search, and web search capabilities.

## Features

- **Document Processing**: Upload and process PDF documents with automatic chunking and embedding
- **Semantic Search**: Search through uploaded documents using vector embeddings
- **Web Search**: Integrate web search results for real-time information
- **Chatbot Interface**: AI-powered responses using Groq's LLM API
- **Vector Database**: ChromaDB for efficient document storage and retrieval

## Tech Stack

- **Framework**: FastAPI
- **Language**: Python 3.8+
- **Vector Database**: ChromaDB
- **Embeddings**: Sentence Transformers (multi-qa-MPNET-base-dot-v1)
- **LLM**: Groq API (Llama3-8b-8192)
- **Web Search**: Serper API
- **Document Processing**: PyMuPDF (fitz)
- **NLP**: spaCy (en_core_web_sm)

## Prerequisites

- Python 3.8 or higher
- pip or conda package manager
- API keys for:
  - [Groq API](https://console.groq.com/) (for LLM responses)
  - [Serper API](https://serper.dev/) (for web search)

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd aeva/backend
   ```

2. **Create a virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` file and add your API keys:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   X-API-KEY=your_serper_api_key_here
   ```

5. **Download spaCy model**
   ```bash
   python -m spacy download en_core_web_sm
   ```

## Running the Application

### Development Server
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Production Server
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`

## API Documentation

Once the server is running, you can access:
- **Interactive API Docs**: `http://localhost:8000/docs`
- **ReDoc Documentation**: `http://localhost:8000/redoc`

## API Endpoints

### 1. File Upload
**POST** `/upload/`

Upload PDF documents for processing and indexing.

**Request:**
- Content-Type: `multipart/form-data`
- Body: PDF files

**Response:**
```json
{
  "message": "Uploaded filename.pdf successfully.",
  "processing_status": "completed"
}
```

### 2. Chat Interface
**POST** `/chat/`

Send queries to the chatbot with different search modes.

**Request Body:**
```json
{
  "message": "Your question here",
  "n_results": 5,
  "search_mode": "study_material"  // or "web_search"
}
```

**Response:**
```json
{
  "ans_source": "study_material",
  "ans": "AI-generated response based on context",
  "relevant_chunks": ["context chunks used for response"],
  "metadata": [{"page_number": 1, "doc_name": "document.pdf"}]
}
```

## Search Modes

### 1. Study Material Mode (`search_mode: "study_material"`)
- Searches through uploaded PDF documents
- Uses semantic similarity to find relevant content
- Returns context-based AI responses

### 2. Web Search Mode (`search_mode: "web_search"`)
- Performs real-time web search
- Uses Serper API to get current information
- Returns AI responses based on web results

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI application entry point
│   ├── schemas.py           # Pydantic models for request/response
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── chatbot.py       # Chat endpoint router
│   │   └── doc_processor.py # File upload router
│   └── logics/
│       ├── __init__.py
│       ├── chat.py          # Main chat logic
│       ├── chatbot.py       # LLM integration
│       ├── data_processor.py # Document processing
│       ├── upload_doc.py    # File upload handling
│       └── web_search.py    # Web search integration
├── requirements.txt         # Python dependencies
├── .env.example            # Environment variables template
├── .gitignore              # Git ignore patterns
└── README.md               # This file
```

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `GROQ_API_KEY` | Groq API key for LLM responses | Yes | - |
| `X-API-KEY` | Serper API key for web search | Yes | - |
| `CHROMA_DB_PATH` | Path for ChromaDB storage | No | `./chroma_db` |
| `UPLOAD_DIR` | Directory for uploaded files | No | `./test_data` |
| `ALLOWED_ORIGINS` | CORS allowed origins | No | `http://localhost:8080,http://localhost:3000` |
| `HOST` | Server host | No | `0.0.0.0` |
| `PORT` | Server port | No | `8000` |
| `DEBUG` | Debug mode | No | `True` |
| `CHUNK_SIZE` | Document chunk size for processing | No | `250` |
| `GROQ_MODEL` | Groq model to use for LLM | No | `llama3-8b-8192` |

## Development

### Code Style
- Follow PEP 8 guidelines
- Use type hints where possible
- Add docstrings for functions and classes

### Testing
```bash
# Run tests (when implemented)
pytest

# Run with coverage
pytest --cov=app
```

### Linting
```bash
# Install linting tools
pip install flake8 black isort

# Run linting
flake8 app/
black app/
isort app/
```

## Troubleshooting

### Common Issues

1. **Import Error: No module named 'spacy'**
   ```bash
   pip install spacy
   python -m spacy download en_core_web_sm
   ```

2. **ChromaDB Connection Error**
   - Ensure the `chroma_db` directory has write permissions
   - Check if the path is correctly configured

3. **API Key Errors**
   - Verify your API keys are correctly set in `.env`
   - Check if the API keys have sufficient credits/permissions

4. **CORS Issues**
   - Update `ALLOWED_ORIGINS` in the environment variables
   - Check if your frontend URL is included in the allowed origins

### Logs
Check the console output for detailed error messages and debug information.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

[Add your license information here]

## Support

For support and questions, please open an issue in the repository or contact the development team.
