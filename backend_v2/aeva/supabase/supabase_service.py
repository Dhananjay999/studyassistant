"""Supabase service for DB, storage, and auth."""

import logging
from typing import Any
from urllib.parse import urlencode

import jwt
import requests
from flask import current_app
from jwt import PyJWKClient
from supabase import Client, create_client

logger = logging.getLogger(__name__)


class SupabaseService:
    """Central Supabase client wrapper."""

    _client: Client | None = None
    _jwks_client: PyJWKClient | None = None

    @property
    def client(self) -> Client:
        """Lazy-init Supabase client within app context."""
        if SupabaseService._client is None:
            SupabaseService._client = create_client(
                current_app.config["SUPABASE_URL"],
                current_app.config["SUPABASE_SERVICE_ROLE_KEY"],
            )
        return SupabaseService._client

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
        response = requests.post(
            f"{base}/auth/v1/token?grant_type=pkce",
            headers={"apikey": key, "Content-Type": "application/json"},
            json={"auth_code": code, "code_verifier": code_verifier},
            timeout=15,
        )
        response.raise_for_status()
        return response.json()

    def refresh_session(self, refresh_token: str) -> dict[str, Any]:
        """Refresh a session using a refresh token."""
        base = current_app.config["SUPABASE_URL"]
        key = current_app.config["SUPABASE_SERVICE_ROLE_KEY"]
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

    # --- Sessions ---

    def create_session(
        self,
        user_id: str,
        title: str = "New chat",
        mode: str = "media",
    ) -> dict[str, Any]:
        """Create a new chat session."""
        result = (
            self.client.table("sessions")
            .insert({"user_id": user_id, "title": title, "mode": mode})
            .execute()
        )
        return result.data[0]

    def list_sessions(self, user_id: str) -> list[dict[str, Any]]:
        """List user sessions ordered by updated_at."""
        result = (
            self.client.table("sessions")
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        return result.data or []

    def get_session(
        self, session_id: str, user_id: str
    ) -> dict[str, Any] | None:
        """Get session if owned by user."""
        result = (
            self.client.table("sessions")
            .select("*")
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

    def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        """Get all messages for a session."""
        result = (
            self.client.table("messages")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at")
            .execute()
        )
        return result.data or []

    # --- Media ---

    def create_media_record(
        self,
        user_id: str,
        file_name: str,
        mime_type: str,
        storage_path: str,
        size_bytes: int,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """Insert media metadata row."""
        result = (
            self.client.table("media")
            .insert({
                "user_id": user_id,
                "session_id": session_id,
                "file_name": file_name,
                "mime_type": mime_type,
                "storage_path": storage_path,
                "size_bytes": size_bytes,
            })
            .execute()
        )
        return result.data[0]

    def list_media(
        self,
        user_id: str,
        session_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """List media for user, optionally filtered by session."""
        query = (
            self.client.table("media")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
        )
        if session_id:
            query = query.eq("session_id", session_id)
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

    # --- Storage ---

    def upload_file(
        self,
        storage_path: str,
        file_bytes: bytes,
        content_type: str,
    ) -> str:
        """Upload file to Supabase Storage."""
        bucket = current_app.config["SUPABASE_STORAGE_BUCKET"]
        self.client.storage.from_(bucket).upload(
            storage_path,
            file_bytes,
            {"content-type": content_type, "upsert": "true"},
        )
        return storage_path

    def download_file(self, storage_path: str) -> bytes:
        """Download file from Supabase Storage."""
        bucket = current_app.config["SUPABASE_STORAGE_BUCKET"]
        return self.client.storage.from_(bucket).download(storage_path)

    def delete_storage_file(self, storage_path: str) -> None:
        """Delete file from Supabase Storage."""
        bucket = current_app.config["SUPABASE_STORAGE_BUCKET"]
        self.client.storage.from_(bucket).remove([storage_path])

    def get_signed_url(
        self, storage_path: str, expires_in: int = 3600
    ) -> str:
        """Get signed URL for a storage file."""
        bucket = current_app.config["SUPABASE_STORAGE_BUCKET"]
        result = self.client.storage.from_(bucket).create_signed_url(
            storage_path, expires_in
        )
        return result.get("signedURL", result.get("signedUrl", ""))
