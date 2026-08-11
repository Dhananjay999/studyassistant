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
from aeva.analytics.analytics_controller import blueprint as analytics_bp
from aeva.assistant.assistant_controller import blueprint as assistant_bp
from aeva.auth.auth_controller import blueprint as auth_bp
from aeva.bookmark.bookmark_controller import blueprint as bookmark_bp
from aeva.chat.chat_controller import blueprint as chat_bp
from aeva.common.errors import CustomError
from aeva.common.logging_config import preview, setup_logging
from aeva.containers import Container
from aeva.delay.delay_controller import blueprint as delay_bp
from aeva.feature_flag import feature_flag_service
from aeva.flashcard.flashcard_controller import blueprint as flashcard_bp
from aeva.learning_profile.learning_profile_controller import (
    blueprint as learning_profile_bp,
)
from aeva.media.media_controller import blueprint as media_bp
from aeva.quiz.quiz_controller import blueprint as quiz_bp
from aeva.revision.revision_controller import blueprint as revision_bp
from aeva.search.search_controller import blueprint as search_bp
from aeva.note.note_controller import blueprint as note_bp
from aeva.session.session_controller import blueprint as session_bp
from aeva.space.space_controller import blueprint as space_bp
from aeva.share.share_controller import (
    legacy_blueprint as share_legacy_bp,
)
from aeva.share.share_controller import (
    public_blueprint as share_public_bp,
)
from aeva.share.share_controller import (
    shares_blueprint as shares_bp,
)

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
    # OpenAI. Optional like Groq: leave OPENAI_API_KEY blank to keep OpenAI
    # disabled. To use it, set a capability's LLM_*_PROVIDER (or LLM_PROVIDER)
    # to "openai" and its model (LLM_*_MODEL / LLM_MODEL) to an OpenAI model,
    # e.g. gpt-4o-mini (or text-embedding-3-small for LLM_EMBEDDING_MODEL).
    app.config["OPENAI_API_KEY"] = os.environ.get("OPENAI_API_KEY", "")
    # Blank uses the SDK default endpoint; set it to target Azure OpenAI or an
    # OpenAI-compatible gateway.
    app.config["OPENAI_BASE_URL"] = os.environ.get("OPENAI_BASE_URL", "")
    # Cap on completion tokens per OpenAI call. 0 (the default) lets OpenAI
    # size the completion itself; set a positive value to bound cost/latency.
    app.config["OPENAI_MAX_TOKENS"] = int(
        os.environ.get("OPENAI_MAX_TOKENS", "0")
    )
    # Reasoning effort for reasoning-capable OpenAI models
    # ("minimal"/"low"/"medium"/"high"). Blank omits the parameter, which
    # non-reasoning models require.
    app.config["OPENAI_REASONING_EFFORT"] = os.environ.get(
        "OPENAI_REASONING_EFFORT", ""
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
    # Image generation must run on an image-capable model; it never falls
    # back to the (text) default model. Pairs with LLM_IMAGE_PROVIDER below.
    app.config["LLM_IMAGE_MODEL"] = os.environ.get(
        "LLM_IMAGE_MODEL", "gpt-image-1"
    )
    app.config["LLM_FLASHCARD_MODEL"] = os.environ.get(
        "LLM_FLASHCARD_MODEL", default_model
    )
    # Per-tool candidate model lists for planner-driven model selection
    # (comma-separated, ordered cheapest -> strongest). The planner picks one
    # per request; the first entry is the cheapest default. Blank falls back to
    # the tool's single LLM_*_MODEL above, so single-model deployments are
    # unchanged. See aeva.orchestration.model_candidates.models_for.
    app.config["GENERAL_LLM_MODELS"] = os.environ.get("GENERAL_LLM_MODELS", "")
    app.config["WEB_SEARCH_LLM_MODELS"] = os.environ.get(
        "WEB_SEARCH_LLM_MODELS", ""
    )
    app.config["MEDIA_LLM_MODELS"] = os.environ.get("MEDIA_LLM_MODELS", "")
    app.config["QUIZ_LLM_MODELS"] = os.environ.get("QUIZ_LLM_MODELS", "")
    app.config["IMAGE_LLM_MODELS"] = os.environ.get("IMAGE_LLM_MODELS", "")
    app.config["FLASHCARD_LLM_MODELS"] = os.environ.get(
        "FLASHCARD_LLM_MODELS", ""
    )
    app.config["PRODUCT_INFO_LLM_MODELS"] = os.environ.get(
        "PRODUCT_INFO_LLM_MODELS", ""
    )
    # Cap on GET /media/ rows (newest first). Bounds the serverless response
    # size — see media_repository.list_media.
    app.config["MEDIA_LIST_LIMIT"] = int(
        os.environ.get("MEDIA_LIST_LIMIT", "300")
    )
    # Dev/QA aid: append a "powered by: <model>" badge to each answer so the
    # model the planner picked is visible in the UI. Off in production.
    app.config["SHOW_MODEL_BADGE"] = os.environ.get(
        "SHOW_MODEL_BADGE", ""
    ).lower() in ("1", "true", "yes", "on")
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
    # Image generation runs on OpenAI by default (independent of the text
    # provider); needs OPENAI_API_KEY. Set both to move it elsewhere.
    app.config["LLM_IMAGE_PROVIDER"] = os.environ.get(
        "LLM_IMAGE_PROVIDER", "openai"
    )
    app.config["LLM_EMBEDDING_PROVIDER"] = os.environ.get(
        "LLM_EMBEDDING_PROVIDER", default_provider
    )

    # Fast-turn capability: greetings and simple chat are answered
    # deterministically (no planner LLM call) by the `general` tool. This gives
    # that path its OWN model + provider, resolved through the same
    # create_provider flow as every other capability. Both fall back to the
    # web-search config (which `general` otherwise shares), so behavior is
    # unchanged until these are set. Point them at a cheap/fast vendor (e.g.
    # LLM_FAST_PROVIDER=groq) to serve greetings/simple chat more cheaply.
    app.config["LLM_FAST_MODEL"] = os.environ.get(
        "LLM_FAST_MODEL", app.config["LLM_WEB_SEARCH_MODEL"]
    )
    app.config["LLM_FAST_PROVIDER"] = os.environ.get(
        "LLM_FAST_PROVIDER", app.config["LLM_WEB_SEARCH_PROVIDER"]
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

    # AI Revision Mode (spaced repetition). Interval ladder + signal
    # thresholds; the quiz thresholds mirror weak(<60)/strong(>=80) used by
    # space stats and space memory so "weak topic" means the same thing
    # everywhere.
    app.config["REVISION_INTERVALS_DAYS"] = os.environ.get(
        "REVISION_INTERVALS_DAYS", "1,3,7,14,30"
    )
    app.config["REVISION_QUIZ_GOOD"] = float(
        os.environ.get("REVISION_QUIZ_GOOD", "80")
    )
    app.config["REVISION_QUIZ_OK"] = float(
        os.environ.get("REVISION_QUIZ_OK", "60")
    )
    app.config["REVISION_FLASHCARD_GOOD"] = float(
        os.environ.get("REVISION_FLASHCARD_GOOD", "0.75")
    )
    app.config["REVISION_FLASHCARD_BAD"] = float(
        os.environ.get("REVISION_FLASHCARD_BAD", "0.4")
    )
    app.config["REVISION_OVERDUE_URGENT_DAYS"] = int(
        os.environ.get("REVISION_OVERDUE_URGENT_DAYS", "2")
    )
    app.config["REVISION_MASTERED_RECENT_DAYS"] = int(
        os.environ.get("REVISION_MASTERED_RECENT_DAYS", "14")
    )
    app.config["REVISION_BACKFILL_LIMIT"] = int(
        os.environ.get("REVISION_BACKFILL_LIMIT", "500")
    )

    # How many recent messages of a session are sent to the LLM as
    # conversation context each turn. 0 (or negative) sends the full session.
    app.config["CHAT_HISTORY_LIMIT"] = int(
        os.environ.get("CHAT_HISTORY_LIMIT", "20")
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
    # Comma list of admin permission grants ("*" = everything). See
    # aeva.admin.admin_auth.KNOWN_PERMISSIONS for the vocabulary.
    app.config["ADMIN_PERMISSIONS"] = os.environ.get(
        "ADMIN_PERMISSIONS", "*"
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
    api.register_blueprint(space_bp)
    api.register_blueprint(note_bp)
    api.register_blueprint(media_bp)
    api.register_blueprint(chat_bp)
    api.register_blueprint(assistant_bp)
    api.register_blueprint(quiz_bp)
    api.register_blueprint(shares_bp)
    api.register_blueprint(share_public_bp)
    api.register_blueprint(share_legacy_bp)
    api.register_blueprint(bookmark_bp)
    api.register_blueprint(search_bp)
    api.register_blueprint(flashcard_bp)
    api.register_blueprint(revision_bp)
    api.register_blueprint(learning_profile_bp)
    api.register_blueprint(analytics_bp)
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
        """Public, non-secret runtime config the frontend needs (limits).

        ``features`` carries the global feature-flag states the frontend
        uses to show/hide optional surfaces. Flag states are not secrets.
        """
        return {
            "max_quiz_questions": app.config["QUIZ_MAX_QUESTIONS"],
            "features": feature_flag_service.get_flags(),
        }

    return app
