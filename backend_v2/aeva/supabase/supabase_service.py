"""Supabase service for DB, storage, and auth."""

import logging
import threading
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

import jwt
import requests
from flask import current_app
from jwt import PyJWKClient
from supabase import Client, create_client

logger = logging.getLogger(__name__)


def _vec_to_str(vector: list[float]) -> str:
    """Serialize an embedding as a pgvector text literal.

    PostgREST speaks JSON, which has no vector type, so a raw list does not
    round-trip into a ``vector`` column. Postgres casts the text form
    ``"[0.1,0.2,...]"`` to ``vector`` on insert and as an RPC argument.
    """
    return "[" + ",".join(str(v) for v in vector) + "]"


class SupabaseService:
    """Central Supabase client wrapper."""

    _local = threading.local()
    _jwks_client: PyJWKClient | None = None

    @property
    def client(self) -> Client:
        """Lazy-init a per-thread Supabase client within app context.

        The client is stored in thread-local storage because the
        underlying postgrest/httpx client speaks HTTP/2, whose sync
        state machine is not thread-safe: sharing one connection across
        Flask worker threads corrupts the multiplexed stream state
        (``StreamIDTooLowError``, ``SEND_HEADERS in state 5``). Giving
        each thread its own client keeps every HTTP/2 connection
        confined to a single thread.
        """
        client = getattr(SupabaseService._local, "client", None)
        if client is None:
            client = create_client(
                current_app.config["SUPABASE_URL"],
                current_app.config["SUPABASE_SERVICE_ROLE_KEY"],
            )
            SupabaseService._local.client = client
        return client

    # --- OAuth (server-side PKCE flow) ---

    def build_oauth_url(
        self,
        provider: str,
        redirect_to: str,
        code_challenge: str,
    ) -> str:
        """Build the Supabase OAuth authorize URL (PKCE)."""
        base = current_app.config["SUPABASE_URL"]
        params = urlencode({
            "provider": provider,
            "redirect_to": redirect_to,
            "code_challenge": code_challenge,
            "code_challenge_method": "s256",
        })
        return f"{base}/auth/v1/authorize?{params}"

    def exchange_code(
        self, code: str, code_verifier: str
    ) -> dict[str, Any]:
        """Exchange an OAuth auth code for a session (PKCE)."""
        base = current_app.config["SUPABASE_URL"]
        key = current_app.config["SUPABASE_SERVICE_ROLE_KEY"]
        logger.info("Auth: exchanging OAuth code for a session (PKCE)")
        response = requests.post(
            f"{base}/auth/v1/token?grant_type=pkce",
            headers={"apikey": key, "Content-Type": "application/json"},
            json={"auth_code": code, "code_verifier": code_verifier},
            timeout=15,
        )
        response.raise_for_status()
        logger.debug("Auth: code exchange succeeded")
        return response.json()

    def refresh_session(self, refresh_token: str) -> dict[str, Any]:
        """Refresh a session using a refresh token."""
        base = current_app.config["SUPABASE_URL"]
        key = current_app.config["SUPABASE_SERVICE_ROLE_KEY"]
        logger.info("Auth: refreshing session with refresh token")
        response = requests.post(
            f"{base}/auth/v1/token?grant_type=refresh_token",
            headers={"apikey": key, "Content-Type": "application/json"},
            json={"refresh_token": refresh_token},
            timeout=15,
        )
        response.raise_for_status()
        return response.json()

    def _get_jwks_client(self) -> PyJWKClient:
        """Lazily build a cached JWKS client for asymmetric tokens."""
        if SupabaseService._jwks_client is None:
            base = current_app.config["SUPABASE_URL"]
            jwks_url = f"{base}/auth/v1/.well-known/jwks.json"
            SupabaseService._jwks_client = PyJWKClient(jwks_url)
        return SupabaseService._jwks_client

    def _decode_token(self, token: str) -> dict[str, Any]:
        """Decode a Supabase JWT (HS256 secret or asymmetric JWKS)."""
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")

        if alg == "HS256":
            key: Any = current_app.config["SUPABASE_JWT_SECRET"]
        else:
            key = self._get_jwks_client().get_signing_key_from_jwt(
                token
            ).key

        return jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience="authenticated",
        )

    def verify_token(self, token: str) -> dict[str, Any] | None:
        """Verify Supabase JWT and return user payload."""
        try:
            payload = self._decode_token(token)
        except Exception as exc:  # noqa: BLE001
            logger.warning("JWT verification failed: %s", exc)
            return None

        user_id = payload.get("sub")
        if not user_id:
            return None

        email = payload.get("email", "")
        try:
            profile = (
                self.client.table("profiles")
                .select("*")
                .eq("id", user_id)
                .maybe_single()
                .execute()
            )
            if profile and profile.data:
                return profile.data
        except Exception:  # noqa: BLE001
            logger.exception("Profile lookup failed for %s", user_id)

        return {"id": user_id, "email": email}

    def upsert_profile(
        self,
        user_id: str,
        email: str,
        full_name: str | None = None,
        avatar_url: str | None = None,
    ) -> dict[str, Any]:
        """Create or update user profile."""
        data = {
            "id": user_id,
            "email": email,
            "full_name": full_name,
            "avatar_url": avatar_url,
        }
        result = (
            self.client.table("profiles")
            .upsert(data, on_conflict="id")
            .execute()
        )
        return result.data[0] if result.data else data

    def get_profile(self, user_id: str) -> dict[str, Any] | None:
        """Get user profile by ID."""
        result = (
            self.client.table("profiles")
            .select("*")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        return result.data if result else None

    def update_learning_profile(
        self, user_id: str, fields: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Patch learning-profile columns on the user's profile row."""
        result = (
            self.client.table("profiles")
            .update(fields)
            .eq("id", user_id)
            .execute()
        )
        return result.data[0] if result.data else None

    # --- Sessions ---

    def create_session(
        self,
        user_id: str,
        title: str = "New chat",
        mode: str = "media",
        space_id: str | None = None,
    ) -> dict[str, Any]:
        """Create a new chat session."""
        row: dict[str, Any] = {
            "user_id": user_id,
            "title": title,
            "mode": mode,
        }
        if space_id:
            row["space_id"] = space_id
        result = self.client.table("sessions").insert(row).execute()
        return result.data[0]

    def list_sessions(
        self, user_id: str, space_id: str | None = None
    ) -> list[dict[str, Any]]:
        """List user sessions ordered by updated_at."""
        query = (
            self.client.table("sessions")
            .select("*")
            .eq("user_id", user_id)
        )
        if space_id:
            query = query.eq("space_id", space_id)
        result = query.order("updated_at", desc=True).execute()
        return result.data or []

    def get_session(
        self, session_id: str, user_id: str
    ) -> dict[str, Any] | None:
        """Get session if owned by user (with its space embedded).

        The embedded ``study_spaces`` relation rides the same query, so space
        context (name/subject, default or not) costs no extra roundtrip on the
        chat hot path. Rows predating migration 016 simply embed nothing.
        """
        result = (
            self.client.table("sessions")
            .select(
                "*, study_spaces("
                "id,name,subject,description,is_default,settings)"
            )
            .eq("id", session_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        return result.data if result else None

    def update_session(
        self, session_id: str, user_id: str, **fields: Any
    ) -> dict[str, Any] | None:
        """Update session fields."""
        result = (
            self.client.table("sessions")
            .update(fields)
            .eq("id", session_id)
            .eq("user_id", user_id)
            .execute()
        )
        return result.data[0] if result.data else None

    def delete_session(self, session_id: str, user_id: str) -> bool:
        """Delete a session."""
        self.client.table("sessions").delete().eq(
            "id", session_id
        ).eq("user_id", user_id).execute()
        return True

    # --- Messages ---

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Add a message to a session."""
        result = (
            self.client.table("messages")
            .insert({
                "session_id": session_id,
                "role": role,
                "content": content,
                "metadata": metadata or {},
            })
            .execute()
        )
        return result.data[0]

    def get_messages(
        self, session_id: str, limit: int | None = None
    ) -> list[dict[str, Any]]:
        """Messages for a session in chronological order.

        With ``limit``, only the *newest* ``limit`` rows are fetched (still
        returned oldest-first) so long sessions don't transfer their entire
        history just to use the tail as LLM context.
        """
        query = (
            self.client.table("messages")
            .select("*")
            .eq("session_id", session_id)
        )
        if limit is not None and limit > 0:
            result = (
                query.order("created_at", desc=True).limit(limit).execute()
            )
            return list(reversed(result.data or []))
        result = query.order("created_at").execute()
        return result.data or []

    # --- Study Spaces ---

    def list_spaces(self, user_id: str) -> list[dict[str, Any]]:
        """User's spaces, most recently active first."""
        result = (
            self.client.table("study_spaces")
            .select("*")
            .eq("user_id", user_id)
            .order("last_activity_at", desc=True)
            .execute()
        )
        return result.data or []

    def get_space(
        self, space_id: str, user_id: str
    ) -> dict[str, Any] | None:
        """Get a space if owned by user."""
        result = (
            self.client.table("study_spaces")
            .select("*")
            .eq("id", space_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        return result.data if result else None

    def create_space(
        self, user_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        """Insert a study space row."""
        result = (
            self.client.table("study_spaces")
            .insert({"user_id": user_id, **fields})
            .execute()
        )
        return result.data[0]

    def update_space(
        self, space_id: str, user_id: str, **fields: Any
    ) -> dict[str, Any] | None:
        """Patch space fields."""
        result = (
            self.client.table("study_spaces")
            .update(fields)
            .eq("id", space_id)
            .eq("user_id", user_id)
            .execute()
        )
        return result.data[0] if result.data else None

    def delete_space(self, space_id: str, user_id: str) -> bool:
        """Delete a space row (content re-filing happens in the repository)."""
        self.client.table("study_spaces").delete().eq("id", space_id).eq(
            "user_id", user_id
        ).execute()
        return True

    def get_or_create_default_space(self, user_id: str) -> dict[str, Any]:
        """The user's General space, created idempotently on first need.

        Backfilled users already have one (migration 016); brand-new users get
        theirs here. The partial unique index (one default per user) makes a
        create race collapse to the existing row on retry.
        """
        result = (
            self.client.table("study_spaces")
            .select("*")
            .eq("user_id", user_id)
            .eq("is_default", True)
            .maybe_single()
            .execute()
        )
        if result and result.data:
            return result.data
        try:
            return self.create_space(
                user_id,
                {"name": "General", "is_default": True, "icon": "sparkles"},
            )
        except Exception:  # unique-index race: another request created it
            retry = (
                self.client.table("study_spaces")
                .select("*")
                .eq("user_id", user_id)
                .eq("is_default", True)
                .maybe_single()
                .execute()
            )
            if retry and retry.data:
                return retry.data
            raise

    def resolve_space(
        self,
        user_id: str,
        space_id: str | None = None,
        session_id: str | None = None,
    ) -> str:
        """Resolve the space a new content row should be filed into.

        Precedence: an explicitly requested space (ownership-verified) → the
        session's space → the user's General space. Content therefore always
        lands in exactly one space, with General as the invisible default.
        """
        if space_id:
            space = self.get_space(space_id, user_id)
            if space:
                return str(space["id"])
        if session_id:
            session = self.get_session(session_id, user_id)
            if session and session.get("space_id"):
                return str(session["space_id"])
        return str(self.get_or_create_default_space(user_id)["id"])

    def touch_space(self, space_id: str) -> None:
        """Bump a space's activity clock (drives Continue Learning order)."""
        self.client.table("study_spaces").update(
            {"last_activity_at": datetime.now(UTC).isoformat()}
        ).eq("id", space_id).execute()

    # --- Media ---

    def create_media_record(
        self,
        user_id: str,
        file_name: str,
        mime_type: str,
        storage_path: str,
        size_bytes: int,
        session_id: str | None = None,
        space_id: str | None = None,
    ) -> dict[str, Any]:
        """Insert media metadata row."""
        row: dict[str, Any] = {
            "user_id": user_id,
            "session_id": session_id,
            "file_name": file_name,
            "mime_type": mime_type,
            "storage_path": storage_path,
            "size_bytes": size_bytes,
        }
        if space_id:
            row["space_id"] = space_id
        result = self.client.table("media").insert(row).execute()
        return result.data[0]

    # Columns the media list actually ships to the client. Never "*": the row
    # also carries search_vector, parser artifact paths, and job ids that
    # inflate the JSON — an unbounded list once blew past the serverless
    # response limit (413 FUNCTION_PAYLOAD_TOO_LARGE) in production.
    _MEDIA_LIST_COLUMNS = (
        "id,user_id,session_id,space_id,file_name,mime_type,storage_path,"
        "size_bytes,created_at,processing_status,processing_error,page_count"
    )

    def list_media(
        self,
        user_id: str,
        session_id: str | None = None,
        space_id: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """List media for user (newest first), optionally filtered/capped."""
        query = (
            self.client.table("media")
            .select(self._MEDIA_LIST_COLUMNS)
            .eq("user_id", user_id)
            .order("created_at", desc=True)
        )
        if session_id:
            query = query.eq("session_id", session_id)
        if space_id:
            query = query.eq("space_id", space_id)
        if limit and limit > 0:
            query = query.limit(limit)
        result = query.execute()
        return result.data or []

    def get_media(
        self, media_id: str, user_id: str
    ) -> dict[str, Any] | None:
        """Get media record by ID."""
        result = (
            self.client.table("media")
            .select("*")
            .eq("id", media_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        return result.data if result else None

    def delete_media_record(self, media_id: str, user_id: str) -> bool:
        """Delete media metadata row."""
        self.client.table("media").delete().eq(
            "id", media_id
        ).eq("user_id", user_id).execute()
        return True

    def attach_media_to_session(
        self,
        media_ids: list[str],
        session_id: str,
        user_id: str,
    ) -> None:
        """Link orphan media rows to a session (owned by user)."""
        if not media_ids:
            return
        (
            self.client.table("media")
            .update({"session_id": session_id})
            .in_("id", media_ids)
            .eq("user_id", user_id)
            .execute()
        )

    # --- Media RAG (parsing artifacts, pages, chunks, vector search) ---

    def update_media_processing(
        self, media_id: str, user_id: str, **fields: Any
    ) -> dict[str, Any] | None:
        """Patch processing status / artifact columns on a media row."""
        result = (
            self.client.table("media")
            .update(fields)
            .eq("id", media_id)
            .eq("user_id", user_id)
            .execute()
        )
        return result.data[0] if result.data else None

    def insert_media_pages(self, rows: list[dict[str, Any]]) -> None:
        """Bulk-insert per-page metadata rows."""
        if not rows:
            return
        logger.info("DB insert media_pages | %d rows", len(rows))
        self.client.table("media_pages").insert(rows).execute()

    def insert_media_chunks(self, rows: list[dict[str, Any]]) -> None:
        """Bulk-insert chunk rows, serializing embeddings for pgvector."""
        if not rows:
            return
        logger.info("DB insert media_chunks | %d rows", len(rows))
        payload = [
            {**row, "embedding": _vec_to_str(row["embedding"])}
            for row in rows
        ]
        self.client.table("media_chunks").insert(payload).execute()

    def delete_media_chunks(self, media_id: str, user_id: str) -> None:
        """Drop a document's chunks and pages (for reprocess/cleanup)."""
        logger.info("DB delete chunks+pages | media=%s", media_id)
        self.client.table("media_chunks").delete().eq(
            "media_id", media_id
        ).eq("user_id", user_id).execute()
        self.client.table("media_pages").delete().eq(
            "media_id", media_id
        ).eq("user_id", user_id).execute()

    def match_chunks(
        self,
        query_vector: list[float],
        user_id: str,
        media_ids: list[str] | None = None,
        top_k: int = 8,
    ) -> list[dict[str, Any]]:
        """Cosine-similarity search over a user's chunks (optional subset)."""
        logger.info(
            "DB match_chunks (vector search) | top_k=%d | media_ids=%s",
            top_k,
            len(media_ids) if media_ids else "all",
        )
        result = self.client.rpc(
            "match_media_chunks",
            {
                "query_embedding": _vec_to_str(query_vector),
                "p_user_id": user_id,
                "p_media_ids": media_ids or None,
                "match_count": top_k,
            },
        ).execute()
        rows = result.data or []
        logger.info("DB match_chunks ← %d chunks", len(rows))
        return rows

    # --- Storage ---

    def upload_file(
        self,
        storage_path: str,
        file_bytes: bytes,
        content_type: str,
    ) -> str:
        """Upload file to Supabase Storage."""
        bucket = current_app.config["SUPABASE_STORAGE_BUCKET"]
        logger.info(
            "Storage upload | %s | %d bytes (%s)",
            storage_path,
            len(file_bytes),
            content_type,
        )
        self.client.storage.from_(bucket).upload(
            storage_path,
            file_bytes,
            {"content-type": content_type, "upsert": "true"},
        )
        return storage_path

    def download_file(self, storage_path: str) -> bytes:
        """Download file from Supabase Storage."""
        bucket = current_app.config["SUPABASE_STORAGE_BUCKET"]
        logger.info("Storage download | %s", storage_path)
        return self.client.storage.from_(bucket).download(storage_path)

    def delete_storage_file(self, storage_path: str) -> None:
        """Delete file from Supabase Storage."""
        bucket = current_app.config["SUPABASE_STORAGE_BUCKET"]
        logger.info("Storage delete | %s", storage_path)
        self.client.storage.from_(bucket).remove([storage_path])

    def get_signed_url(
        self, storage_path: str, expires_in: int | None = None
    ) -> str:
        """Get signed URL for a storage file (TTL from config unless given)."""
        bucket = current_app.config["SUPABASE_STORAGE_BUCKET"]
        ttl = expires_in or current_app.config.get(
            "MEDIA_SIGNED_URL_TTL_SECONDS", 3600
        )
        result = self.client.storage.from_(bucket).create_signed_url(
            storage_path, ttl
        )
        return result.get("signedURL", result.get("signedUrl", ""))

    def get_signed_urls(
        self, storage_paths: list[str], expires_in: int | None = None
    ) -> dict[str, str]:
        """Signed URLs for many storage files in ONE storage API call.

        The per-item ``get_signed_url`` costs one HTTP round-trip each — for a
        media list of hundreds of rows that dominates the request time. Maps
        path -> url; paths the API omits simply have no entry.
        """
        if not storage_paths:
            return {}
        bucket = current_app.config["SUPABASE_STORAGE_BUCKET"]
        ttl = expires_in or current_app.config.get(
            "MEDIA_SIGNED_URL_TTL_SECONDS", 3600
        )
        results = self.client.storage.from_(bucket).create_signed_urls(
            storage_paths, ttl
        )
        urls: dict[str, str] = {}
        for item in results or []:
            url = item.get("signedURL") or item.get("signedUrl") or ""
            path = item.get("path") or ""
            if path and url:
                urls[path] = url
        return urls
