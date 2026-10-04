"""Media routing and processing-failure contracts (pure; no LLM or DB).

Guards the "I uploaded a file but Aeva says it can't find anything" fixes:
- files selected + a study question never routes to a from-memory answer;
- a resolved "which file?" clarification searches for the original question;
- "which file?" is asked at most once, and never when every file is meant;
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


class TestDisambiguateMedia:
    """Several files selected and none named: ask once, or use them all."""

    PDFS = (("m1", "physics.pdf", "application/pdf"),
            ("m2", "chemistry.pdf", "application/pdf"))
    PHOTOS = (("m1", "blob", "image/jpeg"), ("m2", "IMG_2.jpg", "image/jpeg"))

    @staticmethod
    def _decide(files, message: str, history: list | None = None):
        supabase = MagicMock()
        supabase.list_media.return_value = [
            {"id": i, "file_name": name, "mime_type": mime}
            for i, name, mime in files
        ]
        orch = AssistantOrchestrator(
            llm=MagicMock(), registry=MagicMock(), supabase=supabase
        )
        return orch._disambiguate_media(
            _ctx([i for i, _, _ in files]), message, history
        )

    def test_vague_request_asks_with_all_files_first(self):
        plan = self._decide(self.PDFS, "summarise this")
        assert plan is not None
        assert plan["kind"] == "media_choice"
        options = plan["clarification"]["questions"][0]["options"]
        assert options == ["All files", "physics.pdf", "chemistry.pdf"]

    def test_collective_reference_uses_every_file(self):
        for message in (
            "can you use all the pictures provided please",
            "explain these pdfs",
            "compare both",
            "sab files se notes banao",
        ):
            assert self._decide(self.PDFS, message) is None, message

    def test_photos_are_one_document(self):
        assert self._decide(self.PHOTOS, "explain this") is None

    def test_never_asks_twice_in_a_row(self):
        asked = self._decide(self.PDFS, "summarise this")
        history = [
            {"role": "user", "content": "summarise this"},
            {
                "role": "assistant",
                "content": f"**{asked['clarification']['reason']}**",
            },
        ]
        assert self._decide(self.PDFS, "just summarise it", history) is None

    def test_named_file_still_narrows(self):
        plan = self._decide(self.PDFS, "summarise physics.pdf")
        assert _tool(plan)["params"] == {"media_ids": ["m1"]}


class TestRepeatShortcut:
    """"Again" repeats the last quiz only when it is the whole message."""

    @staticmethod
    def _plan(message: str):
        supabase = MagicMock()
        supabase.get_messages.return_value = [
            {"role": "assistant", "metadata": {"tool_used": "quiz_generator"}},
        ]
        orch = AssistantOrchestrator(
            llm=MagicMock(), registry=MagicMock(), supabase=supabase
        )
        return orch._continuation_plan(_ctx(None), message)

    def test_short_repeat_cue_repeats_the_quiz(self):
        plan = self._plan("another one please")
        assert plan is not None
        assert _tool(plan)["tool"] == "quiz_generator"

    def test_pasted_notes_containing_another_go_to_the_planner(self):
        notes = (
            "A foreign key is a column that refers to the primary key of "
            "another table, so the two tables stay consistent."
        )
        assert self._plan(notes) is None


class TestPlannerNoteInMediaPrompt:
    def test_note_reaches_the_file_prompt(self):
        from aeva.llm import prompts

        note = prompts.planner_note_segment("avec sa", "Help me with the PDF")
        rendered = prompts.PromptBuilder.build(
            prompts.MEDIA_TEMPLATE,
            USER_MESSAGE="avec sa",
            PLANNER_NOTE=note,
            DOCUMENT_CONTEXT="(none)",
        )
        assert "Help me with the PDF" in rendered.user_message

    def test_without_a_note_the_prompt_is_unchanged(self):
        from aeva.llm import prompts

        rendered = prompts.PromptBuilder.build(
            prompts.MEDIA_TEMPLATE,
            USER_MESSAGE="what is osmosis?",
            PLANNER_NOTE="",
            DOCUMENT_CONTEXT="(none)",
        )
        assert "what is osmosis?\n\nRules:" in rendered.user_message


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
