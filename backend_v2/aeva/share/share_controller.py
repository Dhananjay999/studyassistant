"""Sharing endpoints.

Three blueprints, one system:

- ``shares``  (auth, ``/shares``)  — owner CRUD: create/get/update/delete a
  share for ANY registered content type. No per-feature endpoints.
- ``share``   (public, ``/share``) — the stable public surface. The share link
  is a backend URL: crawlers get dynamic Open Graph tags (and an optional
  preview image); humans are redirected to the SPA at
  ``{FRONTEND_URL}/share/{share_id}``, which resolves the content via the
  ``/data`` endpoint and renders the right UI for its ``content_type``.
- ``shared``  (public, ``/shared``) — legacy quiz/result link aliases from the
  pre-generic system; they permanently redirect into ``/share/...`` (tokens
  were preserved as share ids by migration 014).
"""

import html
import json
from typing import TYPE_CHECKING, Any, cast

from flask import Response, current_app, make_response, redirect, request
from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.errors import CustomError
from aeva.common.schema import UserData
from aeva.share.schema.share_schema import (
    ShareCreateSchema,
    ShareUpdateSchema,
)
from aeva.share.share_service import ShareService

if TYPE_CHECKING:
    from aeva.share.schema.share_schema import (
        ShareCreateData,
        ShareUpdateData,
    )

shares_blueprint = Blueprint(
    "shares",
    __name__,
    url_prefix="/shares",
    description="Owner share management (any content type)",
)

public_blueprint = Blueprint(
    "share",
    __name__,
    url_prefix="/share",
    description="Public share resolution (guest access)",
)

legacy_blueprint = Blueprint(
    "shared",
    __name__,
    url_prefix="/shared",
    description="Legacy share links (redirects)",
)


# --------------------------------- owner ---------------------------------- #


class ShareCreateEndpoint(MethodView):
    """Create (or reuse) a share link for any shareable resource."""

    @staticmethod
    @shares_blueprint.arguments(ShareCreateSchema)
    @shares_blueprint.response(200)
    @user_required
    def post(current_user: UserData, request_data: object) -> dict[str, Any]:
        """Mint/return the owner's stable public link for a resource."""
        data = cast("ShareCreateData", request_data)
        return ShareService().create(
            current_user.id,
            data.content_type,
            data.content_id,
            request.url_root,
            data.visibility,
        )


class ShareManageEndpoint(MethodView):
    """Owner view / settings / deletion of one share."""

    @staticmethod
    @shares_blueprint.response(200)
    @user_required
    def get(current_user: UserData, share_id: str) -> dict[str, Any]:
        """Fetch a share with its settings and central analytics."""
        return ShareService().get(share_id, current_user.id, request.url_root)

    @staticmethod
    @shares_blueprint.arguments(ShareUpdateSchema)
    @shares_blueprint.response(200)
    @user_required
    def patch(
        current_user: UserData, request_data: object, share_id: str
    ) -> dict[str, Any]:
        """Update visibility / expiry."""
        data = cast("ShareUpdateData", request_data)
        return ShareService().update(
            share_id,
            current_user.id,
            visibility=data.visibility,
            expires_at=data.expires_at,
        )

    @staticmethod
    @shares_blueprint.response(200)
    @user_required
    def delete(current_user: UserData, share_id: str) -> dict[str, Any]:
        """Soft-delete a share; its public link stops resolving."""
        return ShareService().delete(share_id, current_user.id)


shares_blueprint.add_url_rule(
    "/", view_func=ShareCreateEndpoint, endpoint="share_create"
)
shares_blueprint.add_url_rule(
    "/<share_id>", view_func=ShareManageEndpoint, endpoint="share_manage"
)


# --------------------------------- public --------------------------------- #


def _og_html(share_id: str, meta: dict[str, Any]) -> str:
    """Render the crawler OG page that redirects humans to the frontend."""
    frontend = current_app.config["FRONTEND_URL"].rstrip("/")
    human_url = f"{frontend}/share/{share_id}"
    root = request.url_root.rstrip("/")

    e = html.escape
    image_tags = ""
    if meta.get("has_image"):
        og_image = f"{root}/share/{share_id}/og.png"
        image_tags = f"""
<meta property="og:image" content="{e(og_image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{e(og_image)}">"""
    else:
        image_tags = '\n<meta name="twitter:card" content="summary">'

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>{e(meta["title"])}</title>
<meta name="description" content="{e(meta["description"])}">
<link rel="canonical" href="{e(human_url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="StudyAssistant">
<meta property="og:title" content="{e(meta["title"])}">
<meta property="og:description" content="{e(meta["description"])}">
<meta property="og:url" content="{e(human_url)}">{image_tags}
<meta name="twitter:title" content="{e(meta["title"])}">
<meta name="twitter:description" content="{e(meta["description"])}">
<meta http-equiv="refresh" content="0; url={e(human_url)}">
<script>location.replace({json.dumps(human_url)});</script>
</head>
<body style="font-family:system-ui;text-align:center;padding:3rem">
<p>Opening... <a href="{e(human_url)}">Tap here if it does not load.</a></p>
</body>
</html>"""


@public_blueprint.route("/<share_id>")
@public_blueprint.doc(security=[])
def share_page(share_id: str) -> Response:
    """Serve OG tags for crawlers and redirect humans to the SPA."""
    try:
        meta = ShareService().og_meta(share_id)
    except CustomError:
        body = (
            "<!doctype html><meta charset='utf-8'>"
            "<title>Not found</title>"
            "<body style='font-family:system-ui;text-align:center;"
            "padding:3rem'>"
            "<h1>Nothing here</h1>"
            "<p>This share link is invalid or was removed.</p>"
        )
        return make_response(body, 404, {"Content-Type": "text/html"})
    return make_response(
        _og_html(share_id, meta),
        200,
        {"Content-Type": "text/html; charset=utf-8"},
    )


@public_blueprint.route("/<share_id>/data")
@public_blueprint.doc(security=[])
def share_data(share_id: str) -> dict[str, Any]:
    """Resolve a share into its normalized public payload."""
    return ShareService().resolve_public(share_id)


@public_blueprint.route("/<share_id>/submit", methods=["POST"])
@public_blueprint.doc(security=[])
def share_submit(share_id: str) -> dict[str, Any]:
    """Guest interaction on a share (e.g. attempt a shared quiz)."""
    body = request.get_json(silent=True) or {}
    return ShareService().submit(share_id, body)


@public_blueprint.route("/<share_id>/og.png")
@public_blueprint.doc(security=[])
def share_og(share_id: str) -> Response:
    """Dynamic social preview image, when the content type provides one."""
    png = ShareService().og_image(share_id)
    if not png:
        return make_response("", 404)
    resp = make_response(png)
    resp.headers["Content-Type"] = "image/png"
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


# --------------------------------- legacy --------------------------------- #
# Pre-generic quiz/result links live in the wild; migration 014 preserved the
# tokens as share ids, so a permanent redirect into /share/... is enough.


@legacy_blueprint.route("/quiz/<share_token>")
@legacy_blueprint.doc(security=[])
def legacy_quiz(share_token: str) -> Response:
    """Old quiz share link → generic share page."""
    return redirect(f"/share/{share_token}", code=301)


@legacy_blueprint.route("/quiz/<share_token>/og.png")
@legacy_blueprint.doc(security=[])
def legacy_quiz_og(share_token: str) -> Response:
    """Old quiz share preview image → generic one."""
    return redirect(f"/share/{share_token}/og.png", code=301)


@legacy_blueprint.route("/result/<share_token>")
@legacy_blueprint.doc(security=[])
def legacy_result(share_token: str) -> Response:
    """Old result share link → generic share page."""
    return redirect(f"/share/{share_token}", code=301)
