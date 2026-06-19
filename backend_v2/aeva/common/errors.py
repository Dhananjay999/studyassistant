"""Shared error types and codes."""

from typing import Any


ERROR_CODES: dict[str, dict[str, Any]] = {
    "INVALID_USER": {
        "code": "INVALID_USER",
        "message": "Invalid or unauthorized user",
        "status": 401,
    },
    "NOT_FOUND": {
        "code": "NOT_FOUND",
        "message": "Resource not found",
        "status": 404,
    },
    "VALIDATION_ERROR": {
        "code": "VALIDATION_ERROR",
        "message": "Validation failed",
        "status": 400,
    },
    "UPLOAD_ERROR": {
        "code": "UPLOAD_ERROR",
        "message": "File upload failed",
        "status": 400,
    },
    "LLM_ERROR": {
        "code": "LLM_ERROR",
        "message": "LLM request failed",
        "status": 502,
    },
    "TOOL_EXECUTION_ERROR": {
        "code": "TOOL_EXECUTION_ERROR",
        "message": "Tool execution failed",
        "status": 500,
    },
    "CLARIFICATION_EXPIRED": {
        "code": "CLARIFICATION_EXPIRED",
        "message": "Clarification session expired or not found",
        "status": 400,
    },
    "QUIZ_NOT_FOUND": {
        "code": "QUIZ_NOT_FOUND",
        "message": "Quiz not found",
        "status": 404,
    },
    "INTERNAL_ERROR": {
        "code": "INTERNAL_ERROR",
        "message": "Internal server error",
        "status": 500,
    },
}


class CustomError(Exception):
    """Domain error with HTTP status."""

    def __init__(
        self,
        error_info: dict[str, Any],
        status: int | None = None,
        details: str | None = None,
    ) -> None:
        self.code = error_info["code"]
        self.message = details or error_info["message"]
        self.status = status or error_info["status"]
        super().__init__(self.message)
