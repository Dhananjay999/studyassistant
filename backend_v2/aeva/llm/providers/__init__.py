"""LLM providers.

Each provider implements :class:`~aeva.llm.providers.base.LLMProvider` and
translates the shared prompts/output schemas into its own vendor API, so the
rest of the app stays provider-agnostic. Select one via config through
:func:`~aeva.llm.providers.factory.create_provider`.
"""
