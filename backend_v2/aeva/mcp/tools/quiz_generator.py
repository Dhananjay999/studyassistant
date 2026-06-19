"""Quiz generation tool."""

from typing import Any

from flask import current_app

from aeva.llm.llm_client import LLMClient
from aeva.llm import prompts
from aeva.llm.schemas.quiz import QUIZ_GENERATION_SCHEMA
from aeva.mcp.base import BaseTool, ToolContext, ToolDefinition
from aeva.quiz.quiz_repository import QuizRepository


class QuizGeneratorTool(BaseTool):
    """Generate a dynamic quiz and persist it."""

    def __init__(
        self,
        llm: LLMClient | None = None,
        quiz_repo: QuizRepository | None = None,
    ) -> None:
        self._llm = llm
        self._quiz_repo = quiz_repo

    @property
    def llm(self) -> LLMClient:
        """Lazy LLM client."""
        return self._llm or LLMClient(config_key="LLM_QUIZ_MODEL")

    @property
    def quiz_repo(self) -> QuizRepository:
        """Lazy quiz repository."""
        return self._quiz_repo or QuizRepository()

    @property
    def definition(self) -> ToolDefinition:
        """Tool metadata."""
        return ToolDefinition(
            name="quiz_generator",
            description=(
                "Generate a practice quiz with single-select, multi-select, "
                "and true/false questions on a study topic."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "Quiz topic or subject",
                    },
                    "question_count": {
                        "type": "integer",
                        "description": "Number of questions (default 5)",
                    },
                    "difficulty": {
                        "type": "string",
                        "enum": ["easy", "medium", "hard"],
                    },
                    "question_types": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": [
                                "single_select",
                                "multi_select",
                                "true_false",
                            ],
                        },
                    },
                },
                "required": ["topic"],
            },
        )

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict[str, Any]:
        """Generate and persist a quiz."""
        topic = params.get("topic") or ctx.enriched_message
        count = min(
            int(params.get("question_count", 5)),
            current_app.config.get("QUIZ_MAX_QUESTIONS", 10),
        )
        difficulty = params.get("difficulty", "medium")
        types = params.get("question_types") or [
            "single_select",
            "multi_select",
            "true_false",
        ]

        prompt = prompts.QUIZ_GENERATION_PROMPT.format(
            topic=topic,
            count=count,
            difficulty=difficulty,
            types=", ".join(types),
            context=ctx.enriched_message,
        )
        quiz_data = self.llm.generate_structured(
            prompt,
            QUIZ_GENERATION_SCHEMA,
            system_prompt=prompts.SYSTEM_PROMPT,
        )
        quiz = self.quiz_repo.create(
            user_id=ctx.user_id,
            session_id=ctx.session_id,
            quiz_data=quiz_data,
        )
        return {
            "quiz_id": quiz["id"],
            "title": quiz["title"],
            "topic": quiz["topic"],
            "questions": quiz["questions"],
        }
