"""Research how an exam's previous-year questions are asked, before a quiz.

A quiz pitched at an exam ("Exam level: SSC CGL") instead of a difficulty
band first runs one search-grounded call to learn the exam's question
pattern for the topic — formats, phrasing, sub-topic weighting, traps and
real-paper difficulty. The brief becomes the quiz prompt's ``{EXAM_PATTERN}``
style guide. Research is best-effort: on any failure the quiz is still
generated, from the model's own knowledge of the pattern.
"""

import logging
from dataclasses import dataclass, field

from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient

logger = logging.getLogger(__name__)

# Upper bound on the brief handed to the quiz prompt (chars).
_MAX_BRIEF_CHARS = 4000


@dataclass
class ExamResearch:
    """What the research found for one exam + topic."""

    exam: str
    brief: str = ""
    sources: list[dict[str, str]] = field(default_factory=list)


class ExamResearchService:
    """Web-grounded research on an exam's previous-year question pattern."""

    def __init__(self, llm: LLMClient | None = None) -> None:
        self._llm = llm

    @property
    def llm(self) -> LLMClient:
        """Lazy client on the web-search model (search grounding)."""
        if self._llm is None:
            self._llm = LLMClient(config_key="LLM_WEB_SEARCH_MODEL")
        return self._llm

    def research(self, exam: str, topic: str) -> ExamResearch:
        """Search how ``exam`` asks about ``topic``; empty brief on failure."""
        rendered = prompts.PromptBuilder.build(
            prompts.EXAM_STYLE_RESEARCH_TEMPLATE,
            EXAM=exam,
            TOPIC=topic.strip()
            or f"General {exam} preparation (its main sections)",
            CURRENT_DATE=prompts.current_date(),
        )
        try:
            brief = self.llm.generate(
                rendered.user_message,
                system_prompt=rendered.system_prompt,
                use_search=True,
                log_label="exam_research",
            )
            sources = list(self.llm.last_sources or [])
        except Exception:  # noqa: BLE001 — research must never fail a quiz
            logger.warning("Exam research failed for %s", exam, exc_info=True)
            return ExamResearch(exam=exam)
        return ExamResearch(
            exam=exam,
            brief=(brief or "").strip()[:_MAX_BRIEF_CHARS],
            sources=sources,
        )
