"""Fetch a public link as study material (PDF or web page → text).

Students paste syllabus pages, NCERT chapters and shared PDFs into chat;
the planner could only decline them. This module turns such a link into
bytes the media pipeline already understands: a PDF as-is, an HTML page as
plain text. Kept separate from the repository so the network code (limits,
private-address guard, HTML stripping) stays in one place.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urlsplit

import requests

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.media.compression import ALLOWED_PDF_TYPE, ALLOWED_TEXT_TYPE

logger = logging.getLogger(__name__)

MAX_BYTES = 15 * 1024 * 1024
TIMEOUT_S = 20
# Fewer readable characters than this means a login wall or an app shell.
MIN_TEXT_CHARS = 200
_HTTP_ERROR = 400
_CHUNK = 64 * 1024
_USER_AGENT = "StudyAssistant/1.0 (+https://www.studyassistant.in)"
_SKIP_TAGS = frozenset({"script", "style", "noscript", "svg", "head"})
_BLOCK_TAGS = frozenset({
    "p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
    "tr", "table", "section", "article", "header", "footer", "blockquote",
    "pre",
})


@dataclass(frozen=True)
class FetchedLink:
    """What a link resolved to, ready for the upload path."""

    content: bytes
    mime_type: str
    file_name: str


class _TextExtractor(HTMLParser):
    """Collect readable text and the title; drop scripts, styles, markup."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title = ""
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list) -> None:  # noqa: ARG002
        if tag in _SKIP_TAGS:
            self._skip += 1
        if tag == "title":
            self._in_title = True
        if tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS and self._skip:
            self._skip -= 1
        if tag == "title":
            self._in_title = False
        if tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._skip:
            return
        self.parts.append(data)

    def text(self) -> str:
        """Collapsed text with paragraph breaks kept."""
        raw = "".join(self.parts)
        lines = [" ".join(line.split()) for line in raw.splitlines()]
        out: list[str] = []
        blank = False
        for line in lines:
            if line:
                out.append(line)
                blank = False
            elif not blank and out:
                out.append("")
                blank = True
        return "\n".join(out).strip()


def html_to_text(html: str) -> tuple[str, str]:
    """Return ``(text, title)`` for an HTML document."""
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    return parser.text(), " ".join(parser.title.split())


def _refuse(detail: str) -> CustomError:
    return CustomError(ERROR_CODES["VALIDATION_ERROR"], details=detail)


def _assert_public_host(url: str) -> str:
    """Refuse links to private or local addresses (a server-side fetch)."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.scheme not in {"http", "https"} or not host:
        raise _refuse("Only http(s) links can be imported.")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise _refuse("That link's address could not be found.") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
        ):
            raise _refuse("That link points to a private address.")
    return host


def _file_name(url: str, title: str, mime_type: str) -> str:
    parts = urlsplit(url)
    last = parts.path.rstrip("/").rsplit("/", 1)[-1] if parts.path else ""
    if mime_type == ALLOWED_PDF_TYPE:
        name = last if last.lower().endswith(".pdf") else (last or "document")
        return name if name.lower().endswith(".pdf") else f"{name}.pdf"
    base = title or last or parts.hostname or "page"
    return f"{base[:80].strip()}.txt"


def fetch(url: str) -> FetchedLink:
    """Download ``url`` (≤ ``MAX_BYTES``) as a PDF or as page text."""
    _assert_public_host(url)
    try:
        response = requests.get(
            url,
            timeout=TIMEOUT_S,
            stream=True,
            allow_redirects=True,
            headers={"User-Agent": _USER_AGENT, "Accept": "*/*"},
        )
    except requests.RequestException as exc:
        logger.info("Link import failed to connect: %s", type(exc).__name__)
        raise _refuse("Could not reach that link.") from exc
    with response:
        if response.status_code >= _HTTP_ERROR:
            status = response.status_code
            raise _refuse(f"The link returned an error ({status}).")
        if response.url != url:
            _assert_public_host(response.url)
        body = bytearray()
        for chunk in response.iter_content(_CHUNK):
            body.extend(chunk)
            if len(body) > MAX_BYTES:
                raise _refuse("That page or file is larger than 15 MB.")
        content_type = (
            (response.headers.get("Content-Type") or "").split(";", 1)[0]
        ).strip().lower()
    data = bytes(body)
    if content_type == ALLOWED_PDF_TYPE or data[:5] == b"%PDF-":
        name = _file_name(url, "", ALLOWED_PDF_TYPE)
        return FetchedLink(data, ALLOWED_PDF_TYPE, name)
    looks_html = data[:1024].lstrip()[:1].lower() == b"<"
    if content_type in {"text/html", "application/xhtml+xml"} or looks_html:
        text, title = html_to_text(data.decode("utf-8", errors="replace"))
        if len(text) < MIN_TEXT_CHARS:
            raise _refuse(
                "That page has too little readable text (it may need a "
                "login)."
            )
        name = _file_name(url, title, ALLOWED_TEXT_TYPE)
        return FetchedLink(text.encode("utf-8"), ALLOWED_TEXT_TYPE, name)
    if content_type.startswith("text/"):
        name = _file_name(url, "", ALLOWED_TEXT_TYPE)
        return FetchedLink(data, ALLOWED_TEXT_TYPE, name)
    raise _refuse(
        "Only PDF files and web pages can be imported from a link."
    )
