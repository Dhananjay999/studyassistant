"""Bookmark / note reference contracts (no DB).

A bookmark's ``item_ref`` and a note's ``source_ref`` name another row by
id. One client placeholder (``stream-<uuid>``) once reached ``bookmarks``
and every ``GET /bookmarks/`` failed with ``invalid input syntax for type
uuid`` from then on. The API now rejects a non-UUID ref, and the list query
skips one if it is ever present.
"""

from unittest.mock import MagicMock

import pytest
from marshmallow import ValidationError

from aeva.bookmark.bookmark_repository import BookmarkRepository
from aeva.bookmark.schema.bookmark_schema import CreateBookmarkSchema
from aeva.common.uuid_ref import is_uuid
from aeva.note.schema.note_schema import CreateNoteSchema

GOOD = "ed35b023-1c1e-4b0a-9c2a-6a7b8c9d0e1f"
BAD = "stream-d6485ea4-792e-4d0d-9c14-32a7ed5cd189"


class TestIsUuid:
    def test_canonical_uuids_pass(self):
        assert is_uuid(GOOD)
        assert is_uuid(GOOD.upper())

    @pytest.mark.parametrize("value", [BAD, "", None, 42, "not-a-uuid"])
    def test_everything_else_fails(self, value):
        assert not is_uuid(value)


class TestCreateBookmarkSchema:
    def test_uuid_and_null_refs_are_accepted(self):
        data = CreateBookmarkSchema().load(
            {
                "item_type": "response",
                "item_ref": GOOD,
            }
        )
        assert data.item_ref == GOOD
        data = CreateBookmarkSchema().load({"item_type": "response"})
        assert data.item_ref is None

    def test_stream_placeholder_is_rejected(self):
        with pytest.raises(ValidationError) as err:
            CreateBookmarkSchema().load(
                {
                    "item_type": "response",
                    "item_ref": BAD,
                }
            )
        assert "item_ref" in err.value.messages


class TestCreateNoteSchema:
    def test_uuid_and_null_refs_are_accepted(self):
        data = CreateNoteSchema().load(
            {
                "source_type": "response",
                "source_ref": GOOD,
            }
        )
        assert data.source_ref == GOOD
        assert CreateNoteSchema().load({}).source_ref is None

    def test_stream_placeholder_is_rejected(self):
        with pytest.raises(ValidationError) as err:
            CreateNoteSchema().load(
                {
                    "source_type": "response",
                    "source_ref": BAD,
                }
            )
        assert "source_ref" in err.value.messages


class TestAttachSessionIds:
    @staticmethod
    def _supabase(rows: list[dict]) -> MagicMock:
        supabase = MagicMock()
        query = supabase.client.table.return_value.select.return_value
        query.eq.return_value.in_.return_value.execute.return_value.data = rows
        return supabase

    def test_non_uuid_refs_never_reach_the_query(self):
        supabase = self._supabase([{"id": GOOD, "session_id": "s1"}])
        bookmarks = [
            {"item_type": "response", "item_ref": GOOD},
            {"item_type": "response", "item_ref": BAD},
            {"item_type": "response", "item_ref": None},
        ]
        out = BookmarkRepository._attach_session_ids(supabase, "u1", bookmarks)
        query = supabase.client.table.return_value.select.return_value
        query.eq.return_value.in_.assert_called_once_with("id", [GOOD])
        assert [b["session_id"] for b in out] == ["s1", None, None]

    def test_only_bad_refs_means_no_query_at_all(self):
        supabase = self._supabase([])
        bookmarks = [{"item_type": "response", "item_ref": BAD}]
        out = BookmarkRepository._attach_session_ids(supabase, "u1", bookmarks)
        supabase.client.table.assert_not_called()
        assert out[0]["session_id"] is None
