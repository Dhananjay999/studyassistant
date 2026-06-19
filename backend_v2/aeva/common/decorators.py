"""Auth decorators."""

from functools import wraps
from typing import Any, Callable, TypeVar

from flask import request

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import UserData
from aeva.supabase.supabase_service import SupabaseService

F = TypeVar("F", bound=Callable[..., Any])


def user_required(func: F) -> F:
    """Verify Supabase JWT and inject current_user."""

    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise CustomError(ERROR_CODES["INVALID_USER"])

        token = auth_header.split(" ", 1)[1]
        supabase = SupabaseService()
        user = supabase.verify_token(token)
        if not user:
            raise CustomError(ERROR_CODES["INVALID_USER"])

        current_user = UserData(
            id=user["id"],
            email=user.get("email", ""),
            full_name=user.get("full_name"),
            avatar_url=user.get("avatar_url"),
        )
        return func(current_user, *args, **kwargs)

    return wrapper  # type: ignore[return-value]
