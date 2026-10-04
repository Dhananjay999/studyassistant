"""Student-safety rule: the prompt contract and the trace flag (no LLM or DB)."""

from unittest.mock import MagicMock, patch

from aeva.llm.prompts.response_meta import ANSWER_META_INSTRUCTION, META_SENTINEL
from aeva.llm.prompts.system import SYSTEM_PROMPT
from aeva.orchestration.assistant_orchestrator import AssistantOrchestrator
from aeva.tracing.services import safety_trace


def _split(text: str) -> tuple[str, dict]:
    orch = AssistantOrchestrator(
        llm=MagicMock(), registry=MagicMock(), supabase=MagicMock()
    )
    return orch._split_answer_meta(text)


class TestPromptContract:
    def test_system_prompt_carries_the_rule_and_helplines(self):
        assert "Student safety" in SYSTEM_PROMPT
        for helpline in ("1098", "112", "14416"):
            assert helpline in SYSTEM_PROMPT

    def test_trailer_asks_for_the_flag(self):
        assert '"flag":"student_safety"' in ANSWER_META_INSTRUCTION


class TestAnswerFlag:
    def test_flagged_reply_is_noted_on_the_trace(self):
        text = (
            "You are not alone.\n"
            f"{META_SENTINEL}\n"
            '{"available_actions":[],"suggested_followups":[],'
            '"flag":"student_safety"}'
        )
        with patch.object(safety_trace.tracing, "annotate") as annotate:
            answer, meta = _split(text)
        annotate.assert_called_once_with(safety_flag="student_safety")
        assert answer == "You are not alone."
        # The flag never reaches the client: the chips payload is unchanged.
        assert meta == {"available_actions": [], "suggested_followups": []}

    def test_ordinary_reply_is_not_flagged(self):
        text = (
            f"Osmosis is...\n{META_SENTINEL}\n"
            '{"available_actions":["quiz"],"suggested_followups":[]}'
        )
        with patch.object(safety_trace.tracing, "annotate") as annotate:
            _split(text)
        annotate.assert_not_called()

    def test_unknown_or_malformed_flags_are_ignored(self):
        with patch.object(safety_trace.tracing, "annotate") as annotate:
            safety_trace.note_answer_flag('{"flag":"anything the model wrote"}')
            safety_trace.note_answer_flag('{"flag":["student_safety"]}')
            safety_trace.note_answer_flag("not json at all")
            safety_trace.note_answer_flag("[1, 2]")
        annotate.assert_not_called()
