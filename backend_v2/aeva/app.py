"""Flask application factory."""

import logging
import os
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from flask_smorest import Api

from aeva.assistant.assistant_controller import blueprint as assistant_bp
from aeva.auth.auth_controller import blueprint as auth_bp
from aeva.bookmark.bookmark_controller import blueprint as bookmark_bp
from aeva.chat.chat_controller import blueprint as chat_bp
from aeva.common.errors import CustomError
from aeva.containers import Container
from aeva.flashcard.flashcard_controller import blueprint as flashcard_bp
from aeva.media.media_controller import blueprint as media_bp
from aeva.quiz.quiz_controller import blueprint as quiz_bp
from aeva.search.search_controller import blueprint as search_bp
from aeva.session.session_controller import blueprint as session_bp

logger = logging.getLogger(__name__)


def load_env_vars(app: Flask) -> None:
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
    app.config["LLM_FLASHCARD_MODEL"] = os.environ.get(
        "LLM_FLASHCARD_MODEL", default_model
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

    required = [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "GEMINI_API_KEY",
    ]
    for key in required:
        if not app.config[key]:
            msg = f"Env variable {key} must be set"
            raise KeyError(msg)


def create_app() -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)
    load_env_vars(app)

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

    @app.errorhandler(CustomError)
    def handle_custom_error(error: CustomError) -> tuple[Any, int]:
        """Handle domain errors."""
        return jsonify({
            "msg": error.message,
            "code": error.code,
        }), error.status

    @app.errorhandler(Exception)
    def handle_generic_error(error: Exception) -> tuple[Any, int]:
        """Handle unexpected errors."""
        logger.exception("Unhandled error")
        return jsonify({
            "msg": "Internal server error",
            "code": "INTERNAL_ERROR",
        }), 500

    @app.route("/health")
    def health() -> dict[str, str]:
        """Health check endpoint."""
        return {"status": "ok", "version": "2.0.0"}

    return app
