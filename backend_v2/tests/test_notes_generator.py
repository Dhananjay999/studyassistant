"""Notes / revision-sheet generator (R17): routing, tool and the full turn.

The LLM is mocked everywhere; nothing here talks to a model or a database.
"""

import copy
import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from flask import Flask

from aeva.common.errors import CustomError
from aeva.containers import build_tool_registry
from aeva.feature_flag import feature_flag_service
from aeva.llm import prompts
from aeva.mcp.base import (
    ACTION_FLASHCARDS,
    ACTION_QUIZ,
    BaseTool,
    PriorResult,
    ToolContext,
    ToolDefinition,
)
from aeva.mcp.registry import ToolRegistry
from aeva.mcp.tools import notes_generator
from aeva.mcp.tools.notes_generator import NotesGeneratorTool, preview_of
from aeva.media.grounding import Grounding
from aeva.note.note_repository import NoteRepository
from aeva.orchestration import notes_intent
from aeva.orchestration.assistant_orchestrator import AssistantOrchestrator
from aeva.orchestration.models import AssistantContext, FlashcardOptions

SESSION = "11111111-1111-1111-1111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"
NOTE_ID = "44444444-4444-4444-4444-444444444444"

SHEET = (
    "# Kinematics formula sheet\n\n"
    "## Motion in a line\n\n"
    "- $v = u + at$ where $v$ is the final velocity (m/s)\n"
    "- $s = ut + \\frac{1}{2}at^2$\n"
)


# ------------------------------------------------------------------ intent


class TestNotesIntent:
    @pytest.mark.parametrize(
        ("message", "kind"),
        [
            # Users' own words from the report.
            (
                "make easy short all info contained notes from those 5 "
                "uploaded pdf",
                "notes",
            ),
            (
                "Turn these Chapter 1 notes into a 1-page ultra-short "
                "revision sheet",
                "revision_sheet",
            ),
            ("generate a notes quickiy for exam", "notes"),
            (
                "i need all the formulas and units with their corresponding "
                "examples",
                "formula_sheet",
            ),
            ("LIST ALL THE FORMULA", "formula_sheet"),
            # The intent words from the brief.
            ("revision notes on photosynthesis", "revision_sheet"),
            ("make me a revision sheet for chapter 2", "revision_sheet"),
            ("give me a formula sheet for kinematics", "formula_sheet"),
            ("summary notes of chapter 5 please", "revision_sheet"),
            ("important questions for chapter 3", "important_questions"),
            ("cheat sheet for trigonometry", "revision_sheet"),
            ("notes on french revolution", "notes"),
            ("make notes for unit 2", "notes"),
            # Hinglish.
            ("physics ke notes banao", "notes"),
            ("notes chahiye chapter 2 ke", "notes"),
        ],
    )
    def test_detects(self, message, kind):
        assert notes_intent.detect(message) == kind

    @pytest.mark.parametrize(
        "message",
        [
            "explain photosynthesis",
            "hi",
            # Another generator owns the turn.
            "make a quiz from my notes",
            "make flashcards from revision notes",
            # Notes the student already has are the source, not the target.
            "summarize my notes on physics",
            "explain my short notes",
            "give me a summary of my notes for chapter 2",
            "check my notes for mistakes",
            # Questions about the app, or study-skill advice.
            "how do I make notes in this app",
            "how to make notes for physics",
            "where are my notes",
            # The student writes them.
            "I want to take notes while you explain",
            # Working on questions, not listing them.
            "solve these important questions",
            "answer the important questions from my pdf",
            # Near misses.
            "what is a formula",
            "do all the formulas apply here",
            "is this important for the exam",
            "",
        ],
    )
    def test_ignores(self, message):
        assert notes_intent.detect(message) is None, message

    def test_long_messages_are_left_to_the_planner(self):
        pasted = "revision sheet " + "word " * notes_intent.MAX_WORDS
        assert notes_intent.detect(pasted) is None

    def test_the_action_instructions_route_here(self):
        # The two chat actions send these exact instructions (see
        # frontend SuggestedActions.tsx NOTE_ACTIONS).
        assert (
            notes_intent.detect("Make a revision sheet from this.")
            == "revision_sheet"
        )
        assert (
            notes_intent.detect(
                "List the important questions on this, with short model "
                "answers."
            )
            == "important_questions"
        )


def _turn(message: str, **overrides: Any) -> SimpleNamespace:
    fields: dict[str, Any] = {
        "message": message,
        "media_ids": None,
        "clarification": None,
        "source_content": None,
        "quiz_options": None,
        "flashcard_options": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


class TestForcedParams:
    @pytest.fixture(autouse=True)
    def _flags(self, monkeypatch):
        self.enabled = True
        self.asked: list[str] = []

        def is_enabled(key: str) -> bool:
            self.asked.append(key)
            return self.enabled

        monkeypatch.setattr(feature_flag_service, "is_enabled", is_enabled)

    def test_topic(self):
        params = notes_intent.forced_params(_turn("notes on osmosis"))
        assert params == {
            "kind": "notes",
            "topic": "notes on osmosis",
            "from_answer": False,
            "use_media": False,
        }

    def test_selected_files_are_used(self):
        params = notes_intent.forced_params(
            _turn("formula sheet from this pdf", media_ids=["m1"])
        )
        assert params["use_media"] is True
        assert params["from_answer"] is False

    def test_a_card_action_uses_only_its_card(self):
        params = notes_intent.forced_params(
            _turn(
                "Make a revision sheet from this.",
                media_ids=["m1"],
                source_content="Osmosis is ...",
            )
        )
        assert params["from_answer"] is True
        assert params["use_media"] is False

    def test_words_in_the_card_never_route(self):
        turn = _turn(
            "Explain this in more depth.",
            source_content="a revision sheet of important questions",
        )
        assert notes_intent.forced_params(turn) is None

    def test_flag_off(self):
        self.enabled = False
        assert notes_intent.forced_params(_turn("notes on osmosis")) is None
        assert self.asked == ["notes"]

    def test_flag_is_not_read_for_ordinary_messages(self):
        assert notes_intent.forced_params(_turn("explain osmosis")) is None
        assert self.asked == []

    @pytest.mark.parametrize(
        "overrides",
        [
            {"clarification": object()},
            {"quiz_options": object()},
            {"flashcard_options": FlashcardOptions()},
        ],
    )
    def test_forms_and_clarification_replies_never_route(self, overrides):
        turn = _turn("notes on osmosis", **overrides)
        assert notes_intent.forced_params(turn) is None


# ------------------------------------------------------------------ prompt


class TestPrompt:
    def test_title_is_the_leading_heading(self):
        title, body = prompts.split_title(SHEET, "Formula sheet")
        assert title == "Kinematics formula sheet"
        assert body.startswith("## Motion in a line")
        assert "# Kinematics" not in body
        # LaTeX survives: the output is markdown, never JSON.
        assert "\\frac{1}{2}" in body

    def test_fallback_title_keeps_the_whole_text(self):
        title, body = prompts.split_title("- point one\n- point two", "Notes")
        assert title == "Notes"
        assert body == "- point one\n- point two"

    def test_a_fenced_reply_is_unwrapped(self):
        title, body = prompts.split_title(
            "```markdown\n# Cells\n\n- one\n```", "Notes"
        )
        assert (title, body) == ("Cells", "- one")

    def test_every_kind_has_a_label_and_rules(self):
        assert set(prompts.NOTE_KIND_LABELS) == set(notes_intent.KINDS)
        assert set(prompts.NOTE_KIND_RULES) == set(notes_intent.KINDS)
        assert prompts.DEFAULT_NOTE_KIND in notes_intent.KINDS

    def test_important_questions_ask_for_numbered_model_answers(self):
        rendered = prompts.PromptBuilder.build(
            prompts.NOTES_GENERATION_TEMPLATE,
            NOTE_KIND=prompts.NOTE_KIND_LABELS["important_questions"],
            REQUEST="important questions for chapter 3",
            KIND_RULES=prompts.NOTE_KIND_RULES["important_questions"],
        )
        assert "numbered list" in rendered.user_message
        assert "model answer" in rendered.user_message
        assert "important questions for chapter 3" in rendered.user_message
        assert "You are Aeva" in rendered.system_prompt

    def test_preview_is_plain_and_bounded(self):
        preview = preview_of("## Motion\n\n- **v** = `u` + $at$\n" + "x" * 400)
        assert "#" not in preview and "*" not in preview and "`" not in preview
        assert preview.endswith("…")
        assert len(preview) <= 241


# -------------------------------------------------------------------- tool


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config.update(
        LLM_WEB_SEARCH_MODEL="answer-model",
        LLM_FAST_MODEL="fast-model",
        LLM_MEDIA_MODEL="media-model",
    )
    with app.app_context():
        yield app


def _llm(text: str = SHEET) -> MagicMock:
    llm = MagicMock()
    llm.model = "media-model"
    llm.generate.return_value = text
    return llm


def _repo() -> MagicMock:
    repo = MagicMock()
    repo.create_generated.side_effect = lambda user_id, **row: {
        "id": NOTE_ID,
        "title": row["title"],
        "space_id": row.get("space_id") or "general-space",
    }
    return repo


def _tool_ctx(message: str, **overrides: Any) -> ToolContext:
    fields: dict[str, Any] = {
        "user_id": USER,
        "session_id": SESSION,
        "message": message,
        "enriched_message": message,
        "media_ids": None,
        "space_id": "sp1",
        "history": [{"role": "user", "content": "we did kinematics"}],
    }
    fields.update(overrides)
    return ToolContext(**fields)


class TestNotesGeneratorTool:
    def test_writes_saves_and_returns_the_card(self, app):
        llm, repo = _llm(), _repo()
        tool = NotesGeneratorTool(llm=llm, note_repo=repo, supabase=MagicMock())
        notes: list[str] = []
        ctx = _tool_ctx("give me a formula sheet for kinematics")
        ctx.report = notes.append

        result = tool.execute(
            ctx, {"kind": "formula_sheet", "topic": ctx.message}
        )

        body = prompts.split_title(SHEET, "x")[1]
        repo.create_generated.assert_called_once_with(
            USER,
            title="Kinematics formula sheet",
            content_md=body,
            source_type="response",
            space_id="sp1",
        )
        assert result["note_id"] == NOTE_ID
        assert result["title"] == "Kinematics formula sheet"
        assert result["kind"] == "formula_sheet"
        assert result["source"] == "topic"
        assert result["length"] == len(body)
        assert result["preview"]
        assert result["source_media_ids"] == []
        # The whole note is the chat answer.
        assert result["answer"] == f"## Kinematics formula sheet\n\n{body}"
        assert notes == ["Collecting the formulas…", "Saving it to your notes…"]

        # One plain-text call, with the conversation for a topic request.
        llm.generate.assert_called_once()
        user_message = llm.generate.call_args.args[0]
        kwargs = llm.generate.call_args.kwargs
        assert "Note type: Formula sheet" in user_message
        assert "give me a formula sheet for kinematics" in user_message
        assert kwargs["history"] == ctx.history
        assert kwargs["attachments"] is None
        llm.generate_structured.assert_not_called()

    def test_card_action_builds_from_the_answer_only(self, app, monkeypatch):
        grounding_calls: list[dict] = []

        def fake_grounding(ctx, **kwargs):
            grounding_calls.append(kwargs)
            return Grounding()

        monkeypatch.setattr(notes_generator, "ground_generator", fake_grounding)
        llm, repo = _llm(), _repo()
        tool = NotesGeneratorTool(llm=llm, note_repo=repo, supabase=MagicMock())
        enriched = (
            'Make a revision sheet from this.\n\nUse ONLY the following '
            'content as the source.\n"""\nOsmosis moves water.\n"""'
        )
        ctx = _tool_ctx(
            "Make a revision sheet from this.",
            enriched_message=enriched,
            media_ids=["m1"],
        )

        result = tool.execute(
            ctx,
            {
                "kind": "revision_sheet",
                "topic": ctx.message,
                "from_answer": True,
                "use_media": True,  # ignored for a card action
            },
        )

        assert grounding_calls[0]["wants_media"] is False
        assert result["source"] == "answer"
        assert repo.create_generated.call_args.kwargs["source_type"] == "response"
        assert "Osmosis moves water." in llm.generate.call_args.args[0]
        # The card is the only source: the conversation is not sent.
        assert llm.generate.call_args.kwargs["history"] is None

    def test_files_are_the_source_when_selected(self, app, monkeypatch):
        attachments = [{"mime_type": "image/png", "data": b"x"}]
        monkeypatch.setattr(
            notes_generator,
            "ground_generator",
            lambda ctx, **kwargs: Grounding(
                source_context="Excerpts from the student's files:\nNewton\n",
                attachments=attachments,
                from_media=True,
                source_media_ids=["m1", "m2"],
            ),
        )
        llm, repo = _llm(), _repo()
        tool = NotesGeneratorTool(llm=llm, note_repo=repo, supabase=MagicMock())
        ctx = _tool_ctx("revision notes from these pdfs", media_ids=["m1", "m2"])

        result = tool.execute(
            ctx, {"kind": "revision_sheet", "topic": ctx.message, "use_media": True}
        )

        assert result["source"] == "files"
        assert result["source_media_ids"] == ["m1", "m2"]
        assert repo.create_generated.call_args.kwargs["source_type"] == "media"
        assert "Excerpts from the student's files" in (
            llm.generate.call_args.args[0]
        )
        assert llm.generate.call_args.kwargs["attachments"] == attachments
        assert llm.generate.call_args.kwargs["history"] is None

    def test_prior_agent_output_counts_as_an_answer(self, app):
        llm, repo = _llm(), _repo()
        tool = NotesGeneratorTool(llm=llm, note_repo=repo, supabase=MagicMock())
        ctx = _tool_ctx("notes on osmosis")
        ctx.prior_results = [PriorResult(tool="general", text="Osmosis is…")]
        result = tool.execute(ctx, {"kind": "notes", "topic": ctx.message})
        assert result["source"] == "answer"

    def test_unknown_kind_falls_back_to_plain_notes(self, app):
        llm = _llm()
        tool = NotesGeneratorTool(llm=llm, note_repo=_repo(), supabase=MagicMock())
        result = tool.execute(_tool_ctx("notes on osmosis"), {"kind": "poem"})
        assert result["kind"] == "notes"
        assert "Note type: Study notes" in llm.generate.call_args.args[0]

    def test_an_empty_note_fails_instead_of_being_saved(self, app):
        repo = _repo()
        tool = NotesGeneratorTool(
            llm=_llm("# Only a title"), note_repo=repo, supabase=MagicMock()
        )
        with pytest.raises(CustomError):
            tool.execute(_tool_ctx("notes on osmosis"), {"kind": "notes"})
        repo.create_generated.assert_not_called()

    def test_contract(self):
        tool = NotesGeneratorTool(llm=_llm())
        assert tool.definition.name == notes_intent.TOOL == notes_generator.NAME
        assert tool.response_type == "NOTE_CREATED"
        assert tool.available_actions == [ACTION_QUIZ, ACTION_FLASHCARDS]
        assert not tool.can_stream()

    def test_registered_with_the_other_tools(self):
        registry = build_tool_registry(
            *(MagicMock() for _ in range(7)), supabase=MagicMock()
        )
        assert isinstance(registry.get("notes_generator"), NotesGeneratorTool)


class TestCreateGenerated:
    def _supabase(self) -> MagicMock:
        supabase = MagicMock()
        supabase.resolve_space.return_value = "general-space"
        insert = supabase.client.table.return_value.insert
        insert.return_value.execute.return_value.data = [
            {"id": NOTE_ID, "title": "T", "space_id": "sp1"}
        ]
        return supabase

    def test_one_insert_in_the_sessions_space(self):
        supabase = self._supabase()
        row = NoteRepository(supabase).create_generated(
            USER,
            title="  Kinematics  ",
            content_md="body",
            source_type="media",
            space_id="sp1",
        )
        assert row["id"] == NOTE_ID
        supabase.client.table.assert_called_once_with("notes")
        supabase.client.table.return_value.insert.assert_called_once_with({
            "user_id": USER,
            "space_id": "sp1",
            "title": "Kinematics",
            "content_md": "body",
            "source_type": "media",
        })
        supabase.resolve_space.assert_not_called()

    def test_general_space_without_a_session_space(self):
        supabase = self._supabase()
        NoteRepository(supabase).create_generated(
            USER, title="", content_md="body", source_type="response"
        )
        sent = supabase.client.table.return_value.insert.call_args.args[0]
        assert sent["space_id"] == "general-space"
        assert sent["title"] == "Untitled note"
        supabase.resolve_space.assert_called_once_with(USER)


# ----------------------------------------------------------- the full turn


class _Supabase:
    """The slice of SupabaseService a chat turn touches."""

    def __init__(self, messages: list[dict] | None = None) -> None:
        self.messages = messages or []
        self.added: list[dict] = []
        self.client = MagicMock()
        # The run row a clarification is saved as.
        table = self.client.table.return_value
        table.insert.return_value.execute.return_value.data = [{"id": "run-1"}]

    def get_session(self, session_id: str, user_id: str) -> dict | None:
        return {"id": SESSION, "title": "Physics", "space_id": "sp1"}

    def get_profile(self, user_id: str) -> dict:
        return {"full_name": "Asha"}

    def get_messages(self, session_id: str, limit: int | None = None) -> list:
        return list(self.messages)

    def list_media(self, user_id: str) -> list[dict]:
        return []

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: dict | None = None,
        user_id: str | None = None,
    ) -> dict:
        row = {
            "id": f"00000000-0000-0000-0000-{len(self.added) + 1:012d}",
            "role": role,
            "content": content,
            "metadata": copy.deepcopy(metadata or {}),
        }
        self.added.append(row)
        return row

    def update_session(self, *_a: Any, **_k: Any) -> None:
        pass

    def update_learning_profile(self, *_a: Any, **_k: Any) -> None:
        pass


class _Planner:
    model = "planner-model"

    def __init__(self, plan: dict) -> None:
        self.plan = plan
        self.calls = 0

    def generate_structured(self, *_a: Any, **_k: Any) -> dict:
        self.calls += 1
        return copy.deepcopy(self.plan)


class _General(BaseTool):
    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition("general", "general", {"type": "object"})

    def can_stream(self) -> bool:
        return True

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
        return {"answer": "Osmosis moves water.", "sources": []}

    def execute_stream(self, ctx: ToolContext, params: dict[str, Any]):
        yield "Osmosis moves water."
        return {"answer": "Osmosis moves water.", "sources": []}


class _Quiz(BaseTool):
    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition("quiz_generator", "quiz", {"type": "object"})

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
        return {"quiz_id": "q1", "title": "Physics", "questions": [1]}


GENERAL_PLAN = {
    "action": "run_tool",
    "steps": [{"tool": "general", "params": {"query": "q"}}],
}
CLARIFY_PLAN = {
    "action": "clarify",
    "clarification": {
        "reason": "Which topic?",
        "questions": [{"id": "t", "text": "Which topic?", "options": ["A"]}],
    },
}
HISTORY = [
    {"role": "user", "content": "explain kinematics", "metadata": {}},
    {"role": "assistant", "content": "Kinematics is…", "metadata": {}},
]


def _setup(
    plan: dict = GENERAL_PLAN, messages: list[dict] | None = None
) -> tuple[AssistantOrchestrator, _Supabase, _Planner, MagicMock, MagicMock]:
    supabase = _Supabase(messages)
    planner = _Planner(plan)
    llm, repo = _llm(), _repo()
    notes_tool = NotesGeneratorTool(llm=llm, note_repo=repo, supabase=MagicMock())
    orch = AssistantOrchestrator(
        llm=planner,
        registry=ToolRegistry([_General(), _Quiz(), notes_tool]),
        supabase=supabase,
    )
    return orch, supabase, planner, llm, repo


def _frames(orch: AssistantOrchestrator, message: str, **kwargs: Any) -> list[dict]:
    ctx = AssistantContext(
        user_id=USER, session_id=SESSION, message=message, **kwargs
    )
    return [json.loads(f[len("data: "):]) for f in orch.run_stream(ctx)]


class TestNotesTurn:
    @pytest.fixture(autouse=True)
    def _env(self, monkeypatch):
        monkeypatch.setenv("AI_TRACE_ENABLED", "false")
        monkeypatch.setattr(
            feature_flag_service,
            "get_flags",
            lambda: {"web_search": True, "image_generation": True},
        )
        self.flags = {"notes": True, "exam_prep": False}
        monkeypatch.setattr(
            feature_flag_service,
            "is_enabled",
            lambda key: self.flags.get(key, True),
        )

    def test_typed_request_writes_a_saved_note_without_the_planner(self, app):
        orch, supabase, planner, llm, repo = _setup()
        frames = _frames(orch, "give me a formula sheet for kinematics")

        assert planner.calls == 0
        roster = next(f for f in frames if f.get("type") == "agents_planned")
        assert [a["tool"] for a in roster["agents"]] == ["notes_generator"]
        done = frames[-1]
        assert done["done"] is True
        assert done["tool_used"] == "notes_generator"
        content = done["content"]
        assert content["note_id"] == NOTE_ID
        assert content["title"] == "Kinematics formula sheet"
        assert content["kind"] == "formula_sheet"
        assert content["source"] == "topic"
        assert content["response_type"] == "NOTE_CREATED"
        assert content["available_actions"] == [ACTION_QUIZ, ACTION_FLASHCARDS]
        # The note's text is what the student reads in the chat.
        text = "".join(
            f["content"] for f in frames if f.get("content") and not f.get("done")
        )
        assert text.startswith("## Kinematics formula sheet")
        assert "$v = u + at$" in text
        saved = supabase.added[-1]
        assert saved["role"] == "assistant"
        assert saved["content"] == text
        assert saved["metadata"]["tool_used"] == "notes_generator"
        assert saved["metadata"]["content"]["note_id"] == NOTE_ID
        repo.create_generated.assert_called_once()
        assert repo.create_generated.call_args.kwargs["space_id"] == "sp1"
        assert llm.generate.call_count == 1

    def test_action_on_an_answer_that_mentions_a_quiz(self, app):
        # The card's own text must neither route the turn nor open the
        # quiz setup popover.
        orch, _supabase, planner, llm, _repo_ = _setup()
        frames = _frames(
            orch,
            "Make a revision sheet from this.",
            source_content="Osmosis moves water. Take a quiz to test me.",
        )
        assert planner.calls == 0
        assert frames[-1].get("type") != "quiz_setup"
        assert frames[-1]["content"]["source"] == "answer"
        assert "Osmosis moves water." in llm.generate.call_args.args[0]

    def test_this_with_nothing_to_resolve_it_is_left_to_the_planner(self, app):
        orch, _supabase, planner, llm, _repo_ = _setup(plan=CLARIFY_PLAN)
        frames = _frames(orch, "make notes for this")
        assert planner.calls == 1
        assert frames[-1]["type"] == "clarification"
        llm.generate.assert_not_called()

    def test_this_resolves_against_the_conversation(self, app):
        orch, _supabase, planner, llm, _repo_ = _setup(messages=HISTORY)
        frames = _frames(orch, "make notes for this")
        assert planner.calls == 0
        assert frames[-1]["content"]["note_id"] == NOTE_ID
        assert llm.generate.call_args.kwargs["history"]

    def test_flag_off_keeps_the_old_route(self, app):
        self.flags["notes"] = False
        orch, _supabase, planner, llm, repo = _setup()
        frames = _frames(orch, "give me a formula sheet for kinematics")
        assert planner.calls == 1
        assert frames[-1]["tool_used"] == "general"
        assert "note_id" not in frames[-1]["content"]
        llm.generate.assert_not_called()
        repo.create_generated.assert_not_called()

    def test_other_requests_are_untouched(self, app):
        orch, _supabase, planner, llm, _repo_ = _setup()
        frames = _frames(orch, "explain osmosis in simple words")
        assert planner.calls == 1
        assert frames[-1]["tool_used"] == "general"
        llm.generate.assert_not_called()

    def test_a_failed_note_is_reported_not_saved(self, app):
        orch, supabase, _planner, llm, repo = _setup()
        llm.generate.side_effect = RuntimeError("model down")
        frames = _frames(orch, "give me a formula sheet for kinematics")
        status = [f for f in frames if f.get("type") == "agent_status"]
        assert status[-1]["status"] == "failed"
        assert status[-1]["error"] == "RuntimeError"
        done = frames[-1]
        assert "note_id" not in done["content"]
        failed = [a for a in done["content"]["agents"] if a["status"] == "failed"]
        assert [a["tool"] for a in failed] == ["notes_generator"]
        repo.create_generated.assert_not_called()
        assert supabase.added[-1]["role"] == "assistant"
