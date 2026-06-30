"""Dummy delay logic."""

import time
from typing import Any

from aeva.common.schema import success_response


class DelayRepository:
    """Sleep for a requested duration, then return a success envelope."""

    @staticmethod
    def wait(seconds: float) -> dict[str, Any]:
        """Block for ``seconds`` seconds and echo the elapsed time."""
        start = time.monotonic()
        time.sleep(seconds)
        elapsed = round(time.monotonic() - start, 3)
        return success_response(
            f"Waited {elapsed} seconds",
            {"requested_seconds": seconds, "elapsed_seconds": elapsed},
        )
