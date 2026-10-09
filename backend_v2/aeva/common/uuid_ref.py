"""UUID checks for client-supplied references to other rows.

Bookmarks (``item_ref``) and notes (``source_ref``) store the id of the row
they came from in a TEXT column, and the bookmark list joins that value
against a ``uuid`` column. A client once stored its optimistic
``stream-<id>`` placeholder there, and the whole list query failed with
``invalid input syntax for type uuid`` from then on. These helpers reject
such a value at the API boundary and let readers skip one if it ever lands.
"""

import re

from marshmallow import validate

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def is_uuid(value: object) -> bool:
    """Whether ``value`` is a canonical UUID string."""
    return isinstance(value, str) and bool(_UUID_RE.match(value))


def uuid_validator(field_name: str) -> validate.Regexp:
    """Build a marshmallow validator requiring a UUID value.

    ``None`` is still accepted by a field's own ``allow_none``: validators
    only ever see real values.
    """
    return validate.Regexp(_UUID_RE, error=f"{field_name} must be a UUID.")
