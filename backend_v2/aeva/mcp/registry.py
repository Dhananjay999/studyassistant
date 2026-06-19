"""Tool registry for MCP-style tools."""

from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.mcp.base import BaseTool, ToolContext, ToolDefinition


class ToolRegistry:
    """Register and execute tools by name."""

    def __init__(self, tools: list[BaseTool] | None = None) -> None:
        self._tools: dict[str, BaseTool] = {}
        for tool in tools or []:
            self.register(tool)

    def register(self, tool: BaseTool) -> None:
        """Add a tool to the registry."""
        self._tools[tool.definition.name] = tool

    def list_definitions(self) -> list[ToolDefinition]:
        """Return all registered tool definitions."""
        return [t.definition for t in self._tools.values()]

    def get(self, name: str) -> BaseTool:
        """Get a tool by name."""
        tool = self._tools.get(name)
        if not tool:
            raise CustomError(
                ERROR_CODES["TOOL_EXECUTION_ERROR"],
                details=f"Unknown tool: {name}",
            )
        return tool

    def execute(
        self,
        name: str,
        ctx: ToolContext,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute a tool by name."""
        return self.get(name).execute(ctx, params)
