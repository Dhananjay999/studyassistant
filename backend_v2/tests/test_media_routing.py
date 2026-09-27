"""Media routing and processing-failure contracts (pure; no LLM or DB).

Guards the "I uploaded a file but Aeva says it can't find anything" fixes:
- files selected + a study question never routes to a from-memory answer;
- a resolved "which file?" clarification searches for the original question;
- images and not-yet-indexed docs are attached whole instead of dropped;
- a failed or unparseable upload is kept, never deleted.
"""

from unittest.mock import MagicMock

from aeva.mcp.tools.media_llm import MediaLLMTool
from aeva.media.media_processor import MediaProcessor
from aeva.orchestration.assistant_orchestrator import AssistantOrchestrator
from aeva.orchestration.models import AssistantContext


def _ctx(media_ids: list[str] | None = None) -> AssistantContext:
    return AssistantContext(
        user_id="u1", session_id="s1", message="hello", media_ids=media_ids
    )


def _plan(name: str, **params: object) -> dict:
    return {"action": "run_tool", "steps": [{"tool": name, "params": params}]}


def _tool(plan: dict) -> dict:
    return plan["steps"][0]


class TestMediaRoutingGuard:
    guard = staticmethod(AssistantOrchestrator._media_routing_guard)

    def test_general_with_files_becomes_media_llm(self):
        plan = self.guard(
            _plan("general", query="explain chapter 2"),
            _ctx(["m1"]),
            "explain chapter 2",
        )
        assert _tool(plan)["tool"] == "media_llm"
        assert _tool(plan)["params"] == {
            "query": "explain chapter 2",
            "media_ids": ["m1"],
        }
        assert plan["_source"].endswith("+media_guard")

    def test_small_talk_stays_general(self):
        plan = self.guard(_plan("general", query="hi"), _ctx(["m1"]), "hi!")
        assert _tool(plan)["tool"] == "general"

    def test_fresh_info_keeps_web_search(self):
        msg = "latest exam date 2026"
        plan = self.guard(_plan("web_search", query=msg), _ctx(["m1"]), msg)
        assert _tool(plan)["tool"] == "web_search"

    def test_web_search_without_fresh_cue_uses_files(self):
        msg = "what does the chapter say about osmosis"
        plan = self.guard(_plan("web_search", query=msg), _ctx(["m1"]), msg)
        assert _tool(plan)["tool"] == "media_llm"

    def test_no_files_unchanged(self):
        plan = _plan("general", query="explain osmosis")
        assert self.guard(plan, _ctx(None), "explain osmosis") is plan

    def test_clarify_and_generators_untouched(self):
        clarify = {"action": "clarify", "clarification": {}}
        assert self.guard(clarify, _ctx(["m1"]), "x") is clarify
        quiz = _plan("quiz_generator", topic="osmosis")
        assert _tool(self.guard(quiz, _ctx(["m1"]), "quiz me"))["tool"] == (
            "quiz_generator"
        )


class TestForcedPlanQuery:
    def test_media_choice_carries_original_question(self):
        orch = AssistantOrchestrator(
            llm=MagicMock(), registry=MagicMock(), supabase=MagicMock()
        )
        plan = orch._forced_plan(_ctx(["m1", "m2"]), ["m1"], "what is osmosis?")
        assert plan is not None
        assert _tool(plan)["params"] == {
            "media_ids": ["m1"],
            "query": "what is osmosis?",
        }

    def test_media_choice_without_question_omits_query(self):
        orch = AssistantOrchestrator(
            llm=MagicMock(), registry=MagicMock(), supabase=MagicMock()
        )
        plan = orch._forced_plan(_ctx(["m1"]), ["m1"], None)
        assert plan is not None
        assert _tool(plan)["params"] == {"media_ids": ["m1"]}


class TestPartitionRecords:
    def test_mixed_selection(self):
        indexed, images, raw = MediaLLMTool._partition_records([
            {"id": "a", "processing_status": "ready", "chunk_count": 12,
             "mime_type": "application/pdf"},
            {"id": "b", "processing_status": "ready", "chunk_count": 0,
             "mime_type": "image/png"},
            {"id": "c", "processing_status": "parsing", "chunk_count": 0,
             "mime_type": "application/pdf"},
            {"id": "d", "processing_status": "ready", "chunk_count": 0,
             "mime_type": "application/pdf"},
            {"id": "e", "processing_status": "failed", "chunk_count": 0,
             "mime_type": "application/pdf"},
        ])
        assert [r["id"] for r in indexed] == ["a"]
        assert [r["id"] for r in images] == ["b"]
        assert [r["id"] for r in raw] == ["c", "d", "e"]

    def test_attached_labels(self):
        labels = MediaLLMTool._attached_labels(
            [{"file_name": "diagram.png"}],
            [
                {"file_name": "notes.pdf", "processing_status": "embedding"},
                {"file_name": "scan.pdf", "processing_status": "ready"},
            ],
        )
        assert labels == [
            "diagram.png (image)",
            "notes.pdf (still indexing)",
            "scan.pdf (not indexed)",
        ]


class TestProcessorFailureKeepsUpload:
    def _processor(self) -> tuple[MediaProcessor, MagicMock]:
        supabase = MagicMock()
        proc = MediaProcessor(
            supabase=supabase, llamaparse=MagicMock(), embed_llm=MagicMock()
        )
        return proc, supabase

    def test_non_recoverable_marks_failed_and_keeps_files(self):
        proc, supabase = self._processor()
        record = {"id": "m1", "storage_path": "u1/x.pdf"}
        events = list(
            proc._handle_failure("u1", record, "boom", recoverable=False)
        )
        supabase.update_media_processing.assert_called_once_with(
            "m1",
            "u1",
            processing_error="boom",
            processing_status="failed",
            llamaparse_job_id=None,
        )
        supabase.delete_media_record.assert_not_called()
        supabase.delete_storage_file.assert_not_called()
        supabase.delete_media_chunks.assert_not_called()
        assert events[-1]["stage"] == "error"
        assert events[-1]["kept"] is True
        assert events[-1]["recoverable"] is False

    def test_recoverable_keeps_status(self):
        proc, supabase = self._processor()
        list(proc._handle_failure("u1", {"id": "m1"}, "slow", recoverable=True))
        supabase.update_media_processing.assert_called_once_with(
            "m1", "u1", processing_error="slow"
        )

    def test_unindexed_is_ready_with_zero_chunks(self):
        proc, supabase = self._processor()
        events = list(proc._mark_unindexed("u1", {"id": "m1"}, "no text"))
        kwargs = supabase.update_media_processing.call_args.kwargs
        assert kwargs["processing_status"] == "ready"
        assert kwargs["chunk_count"] == 0
        assert kwargs["processing_error"] == "no text"
        assert events[-1]["stage"] == "ready"
        supabase.delete_media_record.assert_not_called()
