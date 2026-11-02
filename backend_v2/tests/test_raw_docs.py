"""Un-indexed documents: inline their text, attach only where it is read."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask

from aeva.mcp.base import ToolContext
from aeva.media.grounding import ground_generator
from aeva.media.raw_docs import (
    documents_attachable,
    inline_text_context,
    triage_raw_docs,
)

FAILED = {
    "id": "f",
    "processing_status": "failed",
    "chunk_count": 0,
    "mime_type": "application/pdf",
    "file_name": "bad.pdf",
}
PENDING = {
    "id": "p",
    "processing_status": "embedding",
    "chunk_count": 0,
    "mime_type": "application/pdf",
    "file_name": "big.pdf",
}
PARSED = {
    "id": "t",
    "processing_status": "failed",
    "chunk_count": 0,
    "mime_type": "application/pdf",
    "file_name": "notes.pdf",
    "parsed_text_path": "u/notes.parsed.txt",
}


class TestTriage:
    def test_provider_check_is_by_name(self):
        assert documents_attachable(SimpleNamespace(provider_name="gemini"))
        assert not documents_attachable(SimpleNamespace(provider_name="openai"))
        # A MagicMock client (tests) or a client without the property: no.
        assert not documents_attachable(MagicMock())
        assert not documents_attachable(object())

    def test_parsed_text_is_always_inlined(self):
        for attachable in (True, False):
            triage = triage_raw_docs([PARSED], attachable=attachable)
            assert triage.inline == [PARSED]
            assert not triage.attach and not triage.failed

    def test_document_provider_attaches_pending_but_never_failed(self):
        triage = triage_raw_docs([FAILED, PENDING], attachable=True)
        assert triage.attach == [PENDING]
        assert triage.failed == [FAILED]
        assert triage.failed_names == ["bad.pdf"]

    def test_image_only_provider_attaches_nothing(self):
        triage = triage_raw_docs([FAILED, PENDING], attachable=False)
        assert triage.attach == []
        assert triage.failed == [FAILED]
        assert triage.processing == [PENDING]


class TestInlineText:
    def test_renders_within_the_budget_with_labels_and_sources(self):
        supabase = MagicMock()
        supabase.download_file.return_value = b"Osmosis moves water. " * 10
        out = inline_text_context(supabase, [PARSED], budget=50)
        assert "[Document: notes.pdf" in out.context
        assert "[cite:notes.pdf]" in out.context
        assert len(out.context) < 50 + 120  # header + a budget-capped body
        assert out.labels == ["notes.pdf (text, not indexed)"]
        assert out.sources == [
            {"media_id": "t", "document_name": "notes.pdf", "page_number": None}
        ]

    def test_a_missing_file_is_skipped_not_fatal(self):
        supabase = MagicMock()
        supabase.download_file.side_effect = RuntimeError("gone")
        out = inline_text_context(supabase, [PARSED], budget=1000)
        assert out.context == "" and out.sources == []


def _ctx(**kw) -> ToolContext:
    base = {
        "user_id": "u", "session_id": "s", "message": "m",
        "enriched_message": "m", "media_ids": ["f"],
    }
    base.update(kw)
    return ToolContext(**base)


class TestGeneratorGrounding:
    def _ground(self, records, llm, media_ids):
        supabase = MagicMock()
        supabase.get_media.side_effect = lambda mid, _u: records[mid]
        supabase.download_file.return_value = b"Newton's laws of motion."
        retrieval = MagicMock()
        with Flask(__name__).app_context(), patch(
            "aeva.media.grounding.download_attachments",
            return_value=[{"mime_type": "application/pdf", "data": b"x"}],
        ) as download:
            g = ground_generator(
                _ctx(media_ids=media_ids), topic="quiz from this pdf",
                wants_media=True, supabase=supabase, retrieval=retrieval, llm=llm,
            )
        return g, download, retrieval

    def test_failed_pdf_is_not_attached_to_a_provider_that_drops_it(self):
        g, download, retrieval = self._ground(
            {"f": FAILED}, SimpleNamespace(provider_name="openai"), ["f"]
        )
        download.assert_not_called()
        retrieval.retrieve.assert_not_called()
        assert g.attachments is None
        assert not g.from_media

    def test_failed_pdf_still_attaches_on_a_document_provider(self):
        g, download, _ = self._ground(
            {"p": PENDING}, SimpleNamespace(provider_name="gemini"), ["p"]
        )
        assert download.call_args.args[3] == ["p"]
        assert g.attachments and g.from_media

    def test_parsed_text_is_inlined_as_the_material(self):
        g, download, _ = self._ground(
            {"t": PARSED}, SimpleNamespace(provider_name="openai"), ["t"]
        )
        download.assert_not_called()
        assert "Newton's laws of motion." in g.source_context
        assert "ONLY material to use" in g.source_context
        assert g.from_media and g.grounded

    def test_without_a_client_the_old_attach_behaviour_is_kept(self):
        g, download, _ = self._ground({"f": FAILED}, None, ["f"])
        assert download.call_args.args[3] == ["f"]
        assert g.attachments
