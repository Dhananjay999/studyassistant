"""Flask application factory."""

import logging
import os
import time
from typing import Any

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from flask_smorest import Api

from aeva.admin.admin_controller import blueprint as admin_bp
from aeva.assistant.assistant_controller import blueprint as assistant_bp
from aeva.auth.auth_controller import blueprint as auth_bp
from aeva.bookmark.bookmark_controller import blueprint as bookmark_bp
from aeva.chat.chat_controller import blueprint as chat_bp
from aeva.common.errors import CustomError
from aeva.common.logging_config import preview, setup_logging
from aeva.containers import Container
from aeva.delay.delay_controller import blueprint as delay_bp
from aeva.flashcard.flashcard_controller import blueprint as flashcard_bp
from aeva.learning_profile.learning_profile_controller import (
    blueprint as learning_profile_bp,
)
from aeva.media.media_controller import blueprint as media_bp
from aeva.quiz.quiz_controller import blueprint as quiz_bp
from aeva.search.search_controller import blueprint as search_bp
from aeva.session.session_controller import blueprint as session_bp

logger = logging.getLogger(__name__)


def load_env_vars(app: Flask) -> None:  # noqa: PLR0915 - flat config loader
    """Load environment variables into app config."""
    load_dotenv()

    app.config["SUPABASE_URL"] = os.environ.get("SUPABASE_URL", "")
    app.config["SUPABASE_SERVICE_ROLE_KEY"] = os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY", ""
    )
    app.config["SUPABASE_JWT_SECRET"] = os.environ.get(
        "SUPABASE_JWT_SECRET", ""
    )
    app.config["SUPABASE_STORAGE_BUCKET"] = os.environ.get(
        "SUPABASE_STORAGE_BUCKET", "media"
    )

    app.config["GEMINI_API_KEY"] = os.environ.get("GEMINI_API_KEY", "")
    # Groq (OpenAI-compatible API). Optional: leave GROQ_API_KEY blank to keep
    # Groq disabled, so Gemini-only deployments are unaffected. To use Groq, set
    # a capability's LLM_*_PROVIDER (or LLM_PROVIDER) to "groq" and its model
    # (LLM_*_MODEL / LLM_MODEL) to a Groq model, e.g. openai/gpt-oss-20b.
    app.config["GROQ_API_KEY"] = os.environ.get("GROQ_API_KEY", "")
    app.config["GROQ_BASE_URL"] = os.environ.get(
        "GROQ_BASE_URL", "https://api.groq.com/openai/v1"
    )
    # Cap on completion tokens per Groq call. Reasoning models (e.g.
    # openai/gpt-oss-20b) otherwise truncate long structured output mid-document
    # -- Groq reports this as json_validate_failed. The cap is also reserved
    # against the account's tokens-per-minute limit (prompt + cap <= TPM), so it
    # is kept modest; raise it on higher Groq tiers if responses get cut off.
    app.config["GROQ_MAX_TOKENS"] = int(
        os.environ.get("GROQ_MAX_TOKENS", "4096")
    )
    # Reasoning effort for reasoning-capable Groq models ("low"/"medium"/"high").
    # Lower effort leaves more of the token budget for the answer, which keeps
    # structured output from being truncated. Blank disables the parameter for
    # non-reasoning Groq models, which reject it.
    app.config["GROQ_REASONING_EFFORT"] = os.environ.get(
        "GROQ_REASONING_EFFORT", "low"
    )
    default_model = os.environ.get("LLM_MODEL", "gemini-2.5-flash")
    app.config["LLM_MODEL"] = default_model
    # Per-capability models (fall back to LLM_MODEL when unset).
    app.config["LLM_ORCHESTRATOR_MODEL"] = os.environ.get(
        "LLM_ORCHESTRATOR_MODEL", default_model
    )
    app.config["LLM_WEB_SEARCH_MODEL"] = os.environ.get(
        "LLM_WEB_SEARCH_MODEL", default_model
    )
    app.config["LLM_MEDIA_MODEL"] = os.environ.get(
        "LLM_MEDIA_MODEL", default_model
    )
    app.config["LLM_QUIZ_MODEL"] = os.environ.get(
        "LLM_QUIZ_MODEL", default_model
    )
    # Quiz performance analysis (POST /quiz/<id>/analyze) can use its own model;
    # falls back to the quiz model, then to the default.
    app.config["LLM_QUIZ_ANALYSIS_MODEL"] = os.environ.get(
        "LLM_QUIZ_ANALYSIS_MODEL", app.config["LLM_QUIZ_MODEL"]
    )
    app.config["LLM_FLASHCARD_MODEL"] = os.environ.get(
        "LLM_FLASHCARD_MODEL", default_model
    )
    # Embedding model for the media RAG retrieval layer. Has its own model
    # (not LLM_MODEL) because chat and embeddings are different model families.
    app.config["LLM_EMBEDDING_MODEL"] = os.environ.get(
        "LLM_EMBEDDING_MODEL", "gemini-embedding-001"
    )

    # LLM provider per capability (fall back to LLM_PROVIDER when unset).
    default_provider = os.environ.get("LLM_PROVIDER", "gemini")
    app.config["LLM_PROVIDER"] = default_provider
    app.config["LLM_ORCHESTRATOR_PROVIDER"] = os.environ.get(
        "LLM_ORCHESTRATOR_PROVIDER", default_provider
    )
    app.config["LLM_WEB_SEARCH_PROVIDER"] = os.environ.get(
        "LLM_WEB_SEARCH_PROVIDER", default_provider
    )
    app.config["LLM_MEDIA_PROVIDER"] = os.environ.get(
        "LLM_MEDIA_PROVIDER", default_provider
    )
    app.config["LLM_QUIZ_PROVIDER"] = os.environ.get(
        "LLM_QUIZ_PROVIDER", default_provider
    )
    # Provider for quiz analysis; falls back to the quiz provider.
    app.config["LLM_QUIZ_ANALYSIS_PROVIDER"] = os.environ.get(
        "LLM_QUIZ_ANALYSIS_PROVIDER", app.config["LLM_QUIZ_PROVIDER"]
    )
    app.config["LLM_FLASHCARD_PROVIDER"] = os.environ.get(
        "LLM_FLASHCARD_PROVIDER", default_provider
    )
    app.config["LLM_EMBEDDING_PROVIDER"] = os.environ.get(
        "LLM_EMBEDDING_PROVIDER", default_provider
    )

    # Media RAG pipeline. LLAMA_CLOUD_API_KEY is optional like Groq: when blank,
    # parsing is disabled and the media tool falls back to direct attachment, so
    # Gemini-only deployments still boot. LLAMAPARSE_MODE is the parse tier
    # (agentic tiers OCR images/handwriting). RAG_EMBEDDING_DIM must match the
    # vector(N) column in migration 007 and the embed output dimensionality.
    app.config["LLAMA_CLOUD_API_KEY"] = os.environ.get(
        "LLAMA_CLOUD_API_KEY", ""
    )
    app.config["LLAMAPARSE_MODE"] = os.environ.get(
        "LLAMAPARSE_MODE", "agentic"
    )
    app.config["RAG_EMBEDDING_DIM"] = int(
        os.environ.get("RAG_EMBEDDING_DIM", "768")
    )
    app.config["RAG_TOP_K"] = int(os.environ.get("RAG_TOP_K", "8"))
    app.config["RAG_CHUNK_TOKENS"] = int(
        os.environ.get("RAG_CHUNK_TOKENS", "512")
    )
    app.config["RAG_CHUNK_OVERLAP"] = int(
        os.environ.get("RAG_CHUNK_OVERLAP", "64")
    )
    # When a doc is not yet indexed, answer it from raw file attachments (the
    # pre-RAG behavior) instead of refusing. Disable once everything is indexed.
    app.config["RAG_ATTACHMENT_FALLBACK"] = (
        os.environ.get("RAG_ATTACHMENT_FALLBACK", "true").lower() == "true"
    )

    app.config["QUIZ_MAX_QUESTIONS"] = int(
        os.environ.get("QUIZ_MAX_QUESTIONS", "10")
    )

    origins = os.environ.get(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:8080",
    )
    app.config["ALLOWED_ORIGINS"] = [
        o.strip() for o in origins.split(",")
    ]
    app.config["MAX_UPLOAD_MB"] = int(
        os.environ.get("MAX_UPLOAD_MB", "10")
    )

    app.config["FRONTEND_URL"] = os.environ.get(
        "FRONTEND_URL", "http://localhost:5173"
    )
    app.config["COOKIE_SECURE"] = (
        os.environ.get("COOKIE_SECURE", "false").lower() == "true"
    )

    # Token / cookie / signed-URL lifetimes — configurable, never hardcoded.
    # ADMIN_TOKEN_EXPIRE_DAYS: TTL of the admin JWT the app mints (default
    # 8h). PKCE_COOKIE_MAX_AGE_SECONDS: how long the OAuth PKCE cookie lives.
    # MEDIA_SIGNED_URL_TTL_SECONDS: validity of storage signed URLs.
    app.config["ADMIN_TOKEN_EXPIRE_DAYS"] = int(
        os.environ.get("ADMIN_TOKEN_EXPIRE_DAYS", "30")
    )
    app.config["PKCE_COOKIE_MAX_AGE_SECONDS"] = int(
        os.environ.get("PKCE_COOKIE_MAX_AGE_SECONDS", "600")
    )
    app.config["MEDIA_SIGNED_URL_TTL_SECONDS"] = int(
        os.environ.get("MEDIA_SIGNED_URL_TTL_SECONDS", "3600")
    )

    # Super Admin panel (optional). When any of these is unset the admin
    # panel stays disabled and its auth fails closed — existing deployments
    # are unaffected. Never hardcode these; they live only in the env.
    app.config["ADMIN_USERNAME"] = os.environ.get("ADMIN_USERNAME", "")
    app.config["ADMIN_PASSWORD"] = os.environ.get("ADMIN_PASSWORD", "")
    app.config["ADMIN_JWT_SECRET"] = os.environ.get("ADMIN_JWT_SECRET", "")

    required = [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "GEMINI_API_KEY",
    ]
    for key in required:
        if not app.config[key]:
            msg = f"Env variable {key} must be set"
            raise KeyError(msg)


# Paths too noisy to log on every hit (health probes, API docs, favicon).
_QUIET_PATHS = ("/health", "/docs", "/openapi", "/favicon")


def _register_request_logging(app: Flask) -> None:
    """Log every request in/out with status + duration (bodies at DEBUG)."""

    @app.before_request
    def _log_start() -> None:
        g.req_started_at = time.perf_counter()
        if request.path.startswith(_QUIET_PATHS):
            return
        logger.info("→ %s %s", request.method, request.path)
        if not logger.isEnabledFor(logging.DEBUG):
            return
        if request.args:
            logger.debug("  query: %s", preview(dict(request.args)))
        ctype = request.content_type or ""
        if ctype.startswith("application/json"):
            logger.debug("  body: %s", preview(request.get_json(silent=True)))
        elif "multipart/form-data" in ctype:
            logger.debug(
                "  body: <multipart upload, %s bytes>",
                request.content_length or 0,
            )

    @app.after_request
    def _log_end(response: Any) -> Any:
        if request.path.startswith(_QUIET_PATHS):
            return response
        start = getattr(g, "_req_start", None)
        took = f"{(time.perf_counter() - start) * 1000:.0f}ms" if start else "?"
        logger.info(
            "← %s %s → %s (%s)",
            request.method,
            request.path,
            response.status_code,
            took,
        )
        return response


def create_app() -> Flask:
    """Create and configure the Flask application."""
    load_dotenv()
    setup_logging()
    app = Flask(__name__)
    load_env_vars(app)
    logger.info("Aeva backend starting up")

    app.config["API_TITLE"] = "Aeva Study Assistant"
    app.config["API_VERSION"] = "v2"
    app.config["OPENAPI_VERSION"] = "3.0.3"
    app.config["OPENAPI_URL_PREFIX"] = "/"
    app.config["OPENAPI_SWAGGER_UI_PATH"] = "/docs"
    app.config["OPENAPI_SWAGGER_UI_URL"] = (
        "https://cdn.jsdelivr.net/npm/swagger-ui-dist/"
    )

    CORS(
        app,
        origins=app.config["ALLOWED_ORIGINS"],
        supports_credentials=True,
    )

    container = Container()
    container.wire(modules=[__name__])
    app.extensions["container"] = container

    api = Api(app)

    # Bearer JWT auth for Swagger UI: registers the scheme and makes it the
    # global default so the "Authorize" button applies to every operation.
    # Public routes opt out with @blueprint.doc(security=[]).
    api.spec.components.security_scheme(
        "bearerAuth",
        {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"},
    )
    api.spec.options["security"] = [{"bearerAuth": []}]

    api.register_blueprint(auth_bp)
    api.register_blueprint(session_bp)
    api.register_blueprint(media_bp)
    api.register_blueprint(chat_bp)
    api.register_blueprint(assistant_bp)
    api.register_blueprint(quiz_bp)
    api.register_blueprint(bookmark_bp)
    api.register_blueprint(search_bp)
    api.register_blueprint(flashcard_bp)
    api.register_blueprint(learning_profile_bp)
    api.register_blueprint(admin_bp)
    api.register_blueprint(delay_bp)

    _register_request_logging(app)

    @app.errorhandler(CustomError)
    def handle_custom_error(error: CustomError) -> tuple[Any, int]:
        """Handle domain errors."""
        logger.warning(
            "Domain error on %s %s | code=%s status=%s | %s",
            request.method,
            request.path,
            error.code,
            error.status,
            error.message,
        )
        return jsonify({
            "msg": error.message,
            "code": error.code,
        }), error.status

    @app.errorhandler(Exception)
    def handle_generic_error(error: Exception) -> tuple[Any, int]:
        """Handle unexpected errors."""
        logger.exception(
            "Unhandled error on %s %s", request.method, request.path
        )
        return jsonify({
            "msg": "Internal server error",
            "code": "INTERNAL_ERROR",
        }), 500

    @app.route("/health")
    def health() -> dict[str, str]:
        """Health check endpoint."""
        return {"status": "ok", "version": "2.0.0"}

    @app.route("/config")
    def public_config() -> dict[str, Any]:
        """Public, non-secret runtime config the frontend needs (limits)."""
        return {"max_quiz_questions": app.config["QUIZ_MAX_QUESTIONS"]}

    return app
