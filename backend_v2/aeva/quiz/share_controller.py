"""Public (no-auth) quiz sharing endpoints.

The share link is a backend URL. When a social crawler fetches it we return
HTML with dynamic Open Graph tags (and a dynamic preview image); when a human
opens it the same page redirects to the frontend SPA, which runs the quiz
against the JSON endpoints here. Every view opts out of the global bearer auth
via ``@blueprint.doc(security=[])`` and validates the opaque share token
server-side.
"""

import html
import json
from typing import Any

from flask import Response, current_app, make_response, request
from flask_smorest import Blueprint

from aeva.common.errors import CustomError
from aeva.quiz.share_og import render_quiz_og_png
from aeva.quiz.share_service import QuizShareService

blueprint = Blueprint(
    "shared",
    __name__,
    url_prefix="/shared",
    description="Public quiz sharing (guest access)",
)


def _description(meta: dict[str, Any]) -> str:
    """Build the social-preview description for a shared quiz."""
    topic = meta["topic"] or "this topic"
    return (
        f"Test your knowledge with this {meta['question_count']}-question "
        f"{topic} quiz generated with AI. Attempt it instantly for free on "
        f"StudyAssistant."
    )


def _og_html(token: str, meta: dict[str, Any]) -> str:
    """Render the crawler OG page that redirects humans to the frontend."""
    frontend = current_app.config["FRONTEND_URL"].rstrip("/")
    human_url = f"{frontend}/quiz/share/{token}"
    root = request.url_root.rstrip("/")
    og_image = f"{root}/shared/quiz/{token}/og.png"

    count = meta["question_count"]
    title = f"{meta['title']} - {count} Questions | StudyAssistant"
    desc = _description(meta)
    e = html.escape
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(human_url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="StudyAssistant">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(human_url)}">
<meta property="og:image" content="{e(og_image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}">
<meta name="twitter:image" content="{e(og_image)}">
<meta http-equiv="refresh" content="0; url={e(human_url)}">
<script>location.replace({json.dumps(human_url)});</script>
</head>
<body style="font-family:system-ui;text-align:center;padding:3rem">
<p>Opening your quiz... <a href="{e(human_url)}">Tap here if it does
not load.</a></p>
</body>
</html>"""


@blueprint.route("/quiz/<share_token>")
@blueprint.doc(security=[])
def share_page(share_token: str) -> Response:
    """Serve OG tags for crawlers and redirect humans to the SPA."""
    try:
        meta = QuizShareService().get_meta(share_token)
    except CustomError:
        body = (
            "<!doctype html><meta charset='utf-8'>"
            "<title>Quiz not found</title>"
            "<body style='font-family:system-ui;text-align:center;"
            "padding:3rem'>"
            "<h1>Quiz not found</h1>"
            "<p>This share link is invalid or was removed.</p>"
        )
        return make_response(body, 404, {"Content-Type": "text/html"})
    return make_response(
        _og_html(share_token, meta),
        200,
        {"Content-Type": "text/html; charset=utf-8"},
    )


@blueprint.route("/quiz/<share_token>/data")
@blueprint.doc(security=[])
def share_data(share_token: str) -> dict[str, Any]:
    """Return the guest quiz payload (no answers) and count a real open."""
    return QuizShareService().get_public_quiz(share_token)


@blueprint.route("/quiz/<share_token>/submit", methods=["POST"])
@blueprint.doc(security=[])
def share_submit(share_token: str) -> dict[str, Any]:
    """Score a guest attempt server-side and store it anonymously."""
    body = request.get_json(silent=True) or {}
    answers = body.get("answers") or {}
    time_taken = body.get("time_taken_seconds", 0)
    return QuizShareService().submit_public(share_token, answers, time_taken)


@blueprint.route("/quiz/<share_token>/og.png")
@blueprint.doc(security=[])
def share_og(share_token: str) -> Response:
    """Render the dynamic social preview image for the shared quiz."""
    meta = QuizShareService().get_meta(share_token)
    png = render_quiz_og_png(
        meta["title"],
        meta["topic"],
        meta["question_count"],
        meta["difficulty"],
        is_exam=meta["is_exam"],
    )
    resp = make_response(png)
    resp.headers["Content-Type"] = "image/png"
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp
