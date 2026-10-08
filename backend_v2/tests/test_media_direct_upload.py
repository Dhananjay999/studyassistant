"""Direct-to-storage uploads (``/media/upload-url`` + ``/media/complete``).

The browser PUTs the file to a signed storage URL and this server only
validates and records it, so the size limit is MAX_UPLOAD_MB rather than the
serverless request-body cap. Repository logic runs over a fake Supabase
service; the blueprint check confirms the routes exist next to the old
multipart one.
"""

import re
from typing import ClassVar

import pytest
from flask import Flask
from marshmallow import ValidationError

from aeva.common.errors import CustomError
from aeva.common.schema import UserData
from aeva.media import media_controller, media_repository
from aeva.media.media_repository import MediaRepository
from aeva.media.schema.media_schema import (
    CompleteUploadData,
    CompleteUploadSchema,
    UploadUrlData,
    UploadUrlSchema,
)

USER = UserData(id="11111111-1111-4111-8111-111111111111", email="a@b.c")
OTHER = "22222222-2222-4222-8222-222222222222"
MB = 1024 * 1024


class FakeSupabase:
    """Records storage and DB calls; answers from attributes set per test."""

    info: ClassVar[dict | None] = {"size": 3 * MB, "content_type": "application/pdf"}
    instances: ClassVar[list["FakeSupabase"]] = []

    def __init__(self):
        self.calls = []
        FakeSupabase.instances.append(self)

    def create_signed_upload_url(self, path):
        self.calls.append(("sign", path))
        return {
            "upload_url": f"https://x.supabase.co/storage/v1/object/upload/sign/b/{path}?token=t",
            "token": "t",
            "storage_path": path,
        }

    def storage_object_info(self, path):
        self.calls.append(("info", path))
        return FakeSupabase.info

    def delete_storage_file(self, path):
        self.calls.append(("delete", path))

    def resolve_space(self, user_id, space_id=None, session_id=None):
        self.calls.append(("space", user_id, space_id, session_id))
        return "space-general"

    def create_media_record(self, **row):
        self.calls.append(("record", row))
        return {"id": "m1", **row, "created_at": "now"}

    def get_signed_url(self, path):
        return f"signed:{path}"


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config.update(MAX_UPLOAD_MB=25, SUPABASE_STORAGE_BUCKET="b")
    return flask_app


@pytest.fixture(autouse=True)
def fake_supabase(monkeypatch):
    FakeSupabase.instances.clear()
    FakeSupabase.info = {"size": 3 * MB, "content_type": "application/pdf"}
    monkeypatch.setattr(media_repository, "SupabaseService", FakeSupabase)
    return FakeSupabase


def _last_calls():
    return FakeSupabase.instances[-1].calls


# ---------------------------------------------------------------------------
# Step 1: upload URL
# ---------------------------------------------------------------------------


def test_upload_url_mints_a_path_under_the_user(app):
    data = UploadUrlData(
        file_name="Notes.PDF", mime_type="application/pdf", size_bytes=20 * MB
    )
    with app.app_context():
        out = MediaRepository.create_upload_url(USER, data)["data"]

    assert out["storage_path"].startswith(f"{USER.id}/")
    assert re.fullmatch(rf"{USER.id}/[0-9a-f]{{32}}\.pdf", out["storage_path"])
    assert out["upload_url"].endswith("?token=t")
    assert out["token"] == "t"  # noqa: S105
    assert out["max_bytes"] == 25 * MB
    assert _last_calls() == [("sign", out["storage_path"])]


def test_upload_url_uses_mime_for_an_untrusted_extension(app):
    data = UploadUrlData(
        file_name="weird.name.with.spaces 1", mime_type="image/png", size_bytes=10
    )
    with app.app_context():
        out = MediaRepository.create_upload_url(USER, data)["data"]
    assert out["storage_path"].endswith(".png")


@pytest.mark.parametrize(
    ("mime", "size", "detail"),
    [
        ("text/plain", 10, "Unsupported file type"),
        ("application/pdf", 0, "File is empty"),
        ("application/pdf", 25 * MB + 1, "exceeds max size of 25MB"),
    ],
)
def test_upload_url_refuses_bad_files_before_minting(app, mime, size, detail):
    data = UploadUrlData(file_name="f", mime_type=mime, size_bytes=size)
    with app.app_context(), pytest.raises(CustomError) as err:
        MediaRepository.create_upload_url(USER, data)
    assert detail in str(err.value.message) + str(
        getattr(err.value, "details", "")
    )
    assert not FakeSupabase.instances or _last_calls() == []


# ---------------------------------------------------------------------------
# Step 2: complete
# ---------------------------------------------------------------------------


def _complete(path, **over):
    base = {
        "storage_path": path,
        "file_name": "Notes.pdf",
        "mime_type": "application/pdf",
        "size_bytes": 0,
        "session_id": "s1",
    }
    base.update(over)
    return CompleteUploadData(**base)


def test_complete_records_what_storage_reports(app):
    path = f"{USER.id}/{'a' * 32}.pdf"
    FakeSupabase.info = {"size": 20 * MB, "content_type": "application/pdf"}
    with app.app_context():
        out = MediaRepository.complete_upload(USER, _complete(path, size_bytes=5))["data"]

    assert out["id"] == "m1"
    assert out["size_bytes"] == 20 * MB
    assert out["mime_type"] == "application/pdf"
    assert out["space_id"] == "space-general"
    assert out["session_id"] == "s1"
    assert out["signed_url"] == f"signed:{path}"
    kinds = [c[0] for c in _last_calls()]
    assert kinds == ["info", "space", "record"]


def test_complete_rejects_a_path_outside_the_users_folder(app):
    with app.app_context(), pytest.raises(CustomError):
        MediaRepository.complete_upload(USER, _complete(f"{OTHER}/{'a' * 32}.pdf"))
    with app.app_context(), pytest.raises(CustomError):
        MediaRepository.complete_upload(
            USER, _complete(f"{USER.id}/../{OTHER}/{'a' * 32}.pdf")
        )
    assert not FakeSupabase.instances


def test_complete_fails_when_the_object_never_arrived(app):
    FakeSupabase.info = None
    with app.app_context(), pytest.raises(CustomError) as err:
        MediaRepository.complete_upload(USER, _complete(f"{USER.id}/{'b' * 32}.pdf"))
    assert err.value.code == "UPLOAD_ERROR"
    assert [c[0] for c in _last_calls()] == ["info"]


def test_complete_removes_an_oversized_object(app):
    path = f"{USER.id}/{'c' * 32}.pdf"
    FakeSupabase.info = {"size": 30 * MB, "content_type": "application/pdf"}
    with app.app_context(), pytest.raises(CustomError):
        MediaRepository.complete_upload(USER, _complete(path))
    assert [c[0] for c in _last_calls()] == ["info", "delete"]


def test_complete_removes_an_object_of_the_wrong_type(app):
    path = f"{USER.id}/{'d' * 32}.pdf"
    FakeSupabase.info = {"size": 10, "content_type": "application/zip"}
    with app.app_context(), pytest.raises(CustomError):
        MediaRepository.complete_upload(USER, _complete(path))
    assert [c[0] for c in _last_calls()] == ["info", "delete"]


# ---------------------------------------------------------------------------
# Schemas and routes
# ---------------------------------------------------------------------------


def test_schemas_validate_shape():
    assert isinstance(
        UploadUrlSchema().load(
            {"file_name": "a.pdf", "mime_type": "application/pdf", "size_bytes": 1}
        ),
        UploadUrlData,
    )
    with pytest.raises(ValidationError):
        UploadUrlSchema().load({"file_name": "a.pdf", "mime_type": "x"})
    loaded = CompleteUploadSchema().load(
        {"storage_path": "u/f.pdf", "file_name": "a.pdf", "mime_type": "application/pdf"}
    )
    assert isinstance(loaded, CompleteUploadData)
    assert loaded.size_bytes == 0


def test_routes_are_registered_next_to_the_multipart_one():
    from flask_smorest import Api

    flask_app = Flask(__name__)
    flask_app.config.update(API_TITLE="t", API_VERSION="1", OPENAPI_VERSION="3.0.2")
    Api(flask_app).register_blueprint(media_controller.blueprint)
    rules = {r.rule for r in flask_app.url_map.iter_rules()}
    assert "/media/upload-url" in rules
    assert "/media/complete" in rules
    assert "/media/" in rules  # the old multipart route is untouched

