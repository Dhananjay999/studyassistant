"""The learning-profile document: shape, API, prompt, and admin."""

from unittest.mock import MagicMock, patch

import pytest
from marshmallow import ValidationError

from aeva.admin.admin_repository import AdminRepository
from aeva.common.schema import UserData
from aeva.learning_profile import profile_document
from aeva.learning_profile.learning_profile_repository import (
    LearningProfileRepository,
)
from aeva.learning_profile.schema.learning_profile_schema import (
    UpdateLearningProfileSchema,
)
from aeva.llm import prompts

COLLEGE = {
    "version": 2,
    "context": {
        "type": "college",
        "degree": "B.Tech / B.E.",
        "year": "3rd Year",
    },
    "goal": "Prepare for placements",
    "focus_areas": ["Data Structures", "System Design"],
    "explanation_style": "Step-by-Step",
    "response_language": "English",
}
ROW = {
    "id": "u1",
    "personalization_status": "completed",
    "learning_profile": COLLEGE,
}


class TestDocument:
    def test_read_returns_every_field_with_defaults(self):
        doc = profile_document.read({})
        assert doc == {
            "context": {},
            "goal": None,
            "explanation_style": None,
            "response_language": None,
            "ai_personality": None,
            "communication_style": None,
            "custom_instructions": None,
            "focus_areas": [],
            "learning_traits": {},
        }
        assert profile_document.read(None) == doc
        assert profile_document.read({"learning_profile": "junk"}) == doc

    def test_read_normalizes_values(self):
        doc = profile_document.read({
            "learning_profile": {
                "context": {"type": " school ", "class": 5, "nope": "x"},
                "goal": "  ",
                "focus_areas": ["Math", " ", 3, " Bio "],
                "learning_traits": {"likes_funny_examples": True, "x": True},
            }
        })
        assert doc["context"] == {"type": "school"}
        assert doc["goal"] is None
        assert doc["focus_areas"] == ["Math", "Bio"]
        assert doc["learning_traits"] == {"likes_funny_examples": True}

    def test_build_omits_empty_fields_and_versions(self):
        assert profile_document.build({}) == {}
        assert profile_document.build({"goal": "", "focus_areas": []}) == {}
        assert profile_document.build(
            {"response_language": "Hindi"}
        ) == {"response_language": "Hindi", "version": 2}

    def test_with_fields_is_a_partial_update(self):
        doc = profile_document.with_fields(ROW, response_language="Hinglish")
        assert doc["response_language"] == "Hinglish"
        assert doc["context"] == COLLEGE["context"]
        assert doc["focus_areas"] == COLLEGE["focus_areas"]


class TestSchema:
    def test_round_trips_the_document(self):
        data = UpdateLearningProfileSchema().load(
            {k: v for k, v in COLLEGE.items() if k != "version"}
        )
        assert profile_document.build(data.as_fields()) == COLLEGE

    @pytest.mark.parametrize(
        "payload",
        [
            {"context": {"home_address": "x"}},
            {"context": {"type": "x" * 41}},
            {"context": {"degree": "x" * 121}},
            {"context": {"year": 3}},
            {"focus_areas": ["x" * 41]},
            {"focus_areas": ["x"] * 21},
            {"learning_traits": {"home_address": "x"}},
            {"education_level": "B.Tech"},  # old flat fields are gone
        ],
    )
    def test_rejects_invalid_payloads(self, payload):
        with pytest.raises(ValidationError):
            UpdateLearningProfileSchema().load(payload)


class TestRepository:
    def test_get_projects_document_and_status(self):
        with patch(
            "aeva.learning_profile.learning_profile_repository.SupabaseService"
        ) as service:
            service.return_value.get_profile.return_value = ROW
            out = LearningProfileRepository.get_profile(
                UserData(id="u1", email="a@b.c")
            )
        data = out["data"]
        assert data["context"] == COLLEGE["context"]
        assert data["personalization_status"] == "completed"
        assert "education_level" not in data

    def test_update_writes_one_document_and_completes(self):
        data = UpdateLearningProfileSchema().load({"goal": "Revision"})
        with patch(
            "aeva.learning_profile.learning_profile_repository.SupabaseService"
        ) as service:
            sb = service.return_value
            sb.get_profile.return_value = ROW
            sb.update_learning_profile.return_value = ROW
            LearningProfileRepository.update_profile(
                UserData(id="u1", email="a@b.c"), data
            )
        _user, fields = sb.update_learning_profile.call_args.args
        assert fields["learning_profile"] == {"goal": "Revision", "version": 2}
        assert fields["personalization_status"] == "completed"


class TestPrompt:
    def test_structured_context_lines(self):
        block = prompts.build_personalization_block(ROW)
        lines = block.split("\n\n")[0].splitlines()
        assert lines == [
            "User Learning Profile:",
            "- Response Language: English",
            "- Learning Context: College / University",
            "- Program: B.Tech / B.E.",
            "- Year: 3rd Year",
            "- Preferred Explanation Style: Step-by-Step",
            "- Learning Goal: Prepare for placements",
            "- Focus Areas: Data Structures, System Design",
        ]

    def test_custom_and_unknown_context(self):
        custom = prompts.build_personalization_block({
            "personalization_status": "completed",
            "learning_profile": {
                "context": {"type": "other", "other": "Gap year"}
            },
        })
        assert "- Learning Context: Gap year" in custom
        unknown = prompts.build_personalization_block({
            "personalization_status": "completed",
            "learning_profile": {"context": {"type": "homeschool"}},
        })
        assert "- Learning Context: homeschool" in unknown

    def test_custom_language_rule(self):
        block = prompts.build_personalization_block({
            "personalization_status": "completed",
            "learning_profile": {"response_language": "Tamil"},
        })
        assert "- Response Language: Tamil" in block
        assert "Any other language" in block


class TestAdmin:
    def _repo(self, row):
        supabase = MagicMock()
        supabase.get_profile.return_value = row
        repo = AdminRepository(supabase)
        repo._audit = MagicMock()  # type: ignore[method-assign]
        return repo, supabase

    def test_reset_clears_the_whole_document(self):
        repo, supabase = self._repo(ROW)
        repo.reset_learning_profile("admin", "u1")
        supabase.update_learning_profile.assert_called_once_with(
            "u1",
            {"learning_profile": {}, "personalization_status": "pending"},
        )

    def test_edit_merges_into_the_document(self):
        repo, supabase = self._repo(ROW)
        table = supabase.client.table.return_value
        table.update.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[ROW])
        )
        repo.edit_profile(
            "admin", "u1", {"full_name": "Asha", "goal": "Revision"}
        )
        update = table.update.call_args.args[0]
        assert update["full_name"] == "Asha"
        assert update["learning_profile"]["goal"] == "Revision"
        # Untouched fields survive the merge.
        assert update["learning_profile"]["context"] == COLLEGE["context"]

    def test_profile_view_exposes_the_document(self):
        view = AdminRepository._profile_view(ROW)
        assert view["learning_profile"]["focus_areas"] == COLLEGE["focus_areas"]
