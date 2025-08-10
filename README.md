# AEVA - AI Study Assistant

AEVA is an intelligent study assistant that combines document processing with AI-powered chat capabilities. It allows users to upload PDF documents, ask questions about the content, and get AI-generated responses based on the uploaded materials or real-time web search.

## 🚀 Features

- **Document Processing**: Upload and process PDF documents for intelligent querying
- **AI-Powered Chat**: Get contextual responses based on uploaded documents
- **Web Search Integration**: Real-time web search capabilities for current information
- **Modern UI**: Clean, responsive interface built with React and Tailwind CSS
- **Fast API Backend**: High-performance backend built with FastAPI
- **Vector Database**: Efficient document storage and retrieval using ChromaDB

## 🏗️ Architecture

```
aeva/
├── backend/                 # FastAPI backend
│   ├── app/
│   │   ├── logics/         # Business logic modules
│   │   ├── routers/        # API route handlers
│   │   └── main.py         # FastAPI application entry point
│   └── requirements.txt    # Python dependencies
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── pages/          # Page components
│   │   └── hooks/          # Custom React hooks
│   └── package.json        # Node.js dependencies
└── README.md              # This file
```

## 🛠️ Technology Stack

### Backend
- **FastAPI**: Modern, fast web framework for building APIs
- **ChromaDB**: Vector database for document embeddings
- **Sentence Transformers**: For document embedding generation
- **Groq API**: High-performance AI model inference
- **Serper API**: Web search capabilities

### Frontend
- **React 18**: Modern React with hooks and concurrent features
- **TypeScript**: Type-safe JavaScript development
- **Vite**: Fast build tool and development server
- **Tailwind CSS**: Utility-first CSS framework
- **Shadcn/ui**: High-quality React components
- **Axios**: HTTP client for API communication

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher)
- **Python** (v3.8 or higher)
- **npm** or **yarn** or **bun**
- **pip** or **conda**

## 🔧 Installation & Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd aeva
```

### 2. Environment Configuration

The project uses environment variables for configuration. Follow these steps:

#### Step 1: Copy Environment Templates

```bash
# Copy the main environment template
cp env.example .env

# Copy backend environment templates
cp backend/env.development backend/.env.development
cp backend/env.production backend/.env.production

# Copy frontend environment templates
cp frontend/env.development frontend/.env.development
cp frontend/env.production frontend/.env.production
```

#### Step 2: Configure Environment Variables

Edit the `.env` files and add your API keys:

**Required API Keys:**
- **Groq API Key**: Get from [Groq Console](https://console.groq.com/)
- **Serper API Key**: Get from [Serper.dev](https://serper.dev/)

**Example `.env` configuration:**
```env
# Backend Configuration
GROQ_API_KEY=your_groq_api_key_here
X-API-KEY=your_serper_api_key_here
GROQ_MODEL=llama3-8b-8192
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080,http://localhost:5173

# Frontend Configuration
VITE_API_URL=http://localhost:8000
VITE_APP_NAME=AEVA Study Assistant
```

### 3. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Download spaCy model (required for text processing)
python -m spacy download en_core_web_sm

# Start the development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend API will be available at `http://localhost:8000`

### 4. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install
# or
yarn install
# or
bun install

# Start the development server
npm run dev
# or
yarn dev
# or
bun dev
```

The frontend will be available at `http://localhost:5173`

## 🌍 Environment Configuration

### Environment Files Structure

```
aeva/
├── env.example              # Main environment template
├── backend/
│   ├── env.development      # Backend development config
│   └── env.production       # Backend production config
└── frontend/
    ├── env.development      # Frontend development config
    └── env.production       # Frontend production config
```

### Key Environment Variables

#### Backend Variables
- `GROQ_API_KEY`: API key for Groq AI model access
- `X-API-KEY`: API key for Serper web search
- `GROQ_MODEL`: AI model selection (default: llama3-8b-8192)
- `ALLOWED_ORIGINS`: CORS allowed origins
- `PORT`: Server port (default: 8000)
- `HOST`: Server host (default: 0.0.0.0)
- `CHROMA_DB_PATH`: ChromaDB storage path
- `LOG_LEVEL`: Logging level (INFO/DEBUG)

#### Frontend Variables
- `VITE_API_URL`: Backend API base URL
- `VITE_APP_NAME`: Application name
- `VITE_APP_VERSION`: Application version
- `VITE_ENABLE_FILE_UPLOAD`: Enable file upload feature
- `VITE_ENABLE_WEB_SEARCH`: Enable web search feature
- `VITE_MAX_FILE_SIZE`: Maximum file size in bytes
- `VITE_MAX_FILES`: Maximum number of files
- `VITE_DEBUG`: Enable debug mode

### Environment-Specific Configurations

#### Development
- Debug logging enabled
- Hot reload enabled
- Localhost origins allowed
- Development-specific features enabled

#### Production
- Optimized logging
- Security-focused settings
- Production domain origins
- Performance optimizations

## 🚀 Usage

### 1. Upload Documents
- Click the file upload area or drag and drop PDF files
- Supported format: PDF
- Maximum file size: 10MB (configurable)
- Maximum files: 5 (configurable)

### 2. Chat with Documents
- Select "PDF Mode" to ask questions about uploaded documents
- The AI will search through your documents and provide contextual answers
- View source information and page numbers for responses

### 3. Web Search
- Select "Web Mode" to search the internet for current information
- Get real-time answers based on web search results
- View source links and metadata

## 📚 API Documentation

Once the backend server is running, you can access:

- **Interactive API Docs**: `http://localhost:8000/docs`
- **ReDoc Documentation**: `http://localhost:8000/redoc`

### Key API Endpoints

#### File Upload
```
POST /upload/
Content-Type: multipart/form-data
```

#### Chat Interface
```
POST /chat/
Content-Type: application/json

{
  "message": "Your question here",
  "n_results": 5,
  "search_mode": "study_material"  // or "web_search"
}
```

## 🔒 Security Considerations

1. **API Keys**: Never commit API keys to version control
2. **Environment Files**: Keep `.env` files secure and out of version control
3. **CORS**: Configure allowed origins properly for production
4. **File Uploads**: Implement proper file validation and size limits
5. **Rate Limiting**: Consider implementing rate limiting for production

## 🧪 Development

### Running Tests
```bash
# Backend tests
cd backend
python -m pytest

# Frontend tests
cd frontend
npm test
```

### Code Quality
```bash
# Backend linting
cd backend
flake8 app/
black app/

# Frontend linting
cd frontend
npm run lint
npm run format
```

## 📦 Deployment

### Backend Deployment
1. Set up production environment variables
2. Use a production WSGI server (Gunicorn)
3. Configure reverse proxy (Nginx)
4. Set up proper logging and monitoring

### Frontend Deployment
1. Build the production bundle: `npm run build`
2. Deploy to static hosting (Vercel, Netlify, etc.)
3. Configure environment variables for production
4. Set up proper CORS origins

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

If you encounter any issues:

1. Check the [Issues](https://github.com/your-repo/issues) page
2. Review the environment configuration
3. Ensure all dependencies are properly installed
4. Check the API documentation at `/docs`

## 🔄 Updates

To update the project:

```bash
# Backend updates
cd backend
pip install -r requirements.txt --upgrade

# Frontend updates
cd frontend
npm update
```

---

**Note**: Make sure to replace placeholder values in environment files with your actual API keys and configuration before running the application.
