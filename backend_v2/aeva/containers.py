"""Dependency injection container."""

from dependency_injector import containers, providers

from aeva.llm.llm_client import LLMClient
from aeva.mcp.registry import ToolRegistry
from aeva.mcp.tools.media_llm import MediaLLMTool
from aeva.mcp.tools.quiz_generator import QuizGeneratorTool
from aeva.mcp.tools.web_search import WebSearchTool
from aeva.supabase.supabase_service import SupabaseService


def build_tool_registry(
    web_search_llm: LLMClient,
    media_llm: LLMClient,
    quiz_llm: LLMClient,
    supabase: SupabaseService,
) -> ToolRegistry:
    """Create registry with per-tool LLM clients."""
    registry = ToolRegistry()
    registry.register(WebSearchTool(llm=web_search_llm))
    registry.register(MediaLLMTool(llm=media_llm, supabase=supabase))
    registry.register(QuizGeneratorTool(llm=quiz_llm, supabase=supabase))
    return registry


class Container(containers.DeclarativeContainer):
    """Application DI container."""

    wiring_config = containers.WiringConfiguration(packages=["aeva"])

    supabase_service = providers.Singleton(SupabaseService)

    llm_default = providers.Singleton(LLMClient)
    llm_orchestrator = providers.Singleton(
        LLMClient,
        config_key="LLM_ORCHESTRATOR_MODEL",
    )
    llm_web_search = providers.Singleton(
        LLMClient,
        config_key="LLM_WEB_SEARCH_MODEL",
    )
    llm_media = providers.Singleton(
        LLMClient,
        config_key="LLM_MEDIA_MODEL",
    )
    llm_quiz = providers.Singleton(
        LLMClient,
        config_key="LLM_QUIZ_MODEL",
    )

    tool_registry = providers.Singleton(
        build_tool_registry,
        web_search_llm=llm_web_search,
        media_llm=llm_media,
        quiz_llm=llm_quiz,
        supabase=supabase_service,
    )
