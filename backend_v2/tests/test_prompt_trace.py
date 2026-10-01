"""prompt_trace.explain: which user detail produced which prompt line.

The breakdown is learned by probing the real, unmodified builders in
``aeva.llm.prompts.personalization``; these tests hold it to them.
"""

import random
from unittest.mock import MagicMock

import pytest

from aeva.llm import prompts
from aeva.llm.prompts import personalization
from aeva.tracing.services import prompt_trace

PROFILE = {
    "full_name": "Asha",
    "personalization_status": "completed",
    "preferred_language": "Hinglish",
    "ai_personality": "Study Buddy",
    "education_level": " Class 12 ",
    "favorite_subjects": ["Biology", "Chemistry"],
    "learning_traits": {
        "likes_funny_examples": True,
        "likes_visual_explanations": False,
        "preferred_depth": "deep",
    },
    "custom_instructions": "Keep it short",
}
SPACE = {
    "name": "Cells",
    "subject": "Biology",
    "settings": {
        "memory": {
            "recent_quizzes": [{"topic": "Mitosis", "score": 60}],
            "weak_topics": ["Meiosis"],
        }
    },
}
PROFILE_HEAD = "User Learning Profile:\n"
SPACE_HEAD = (
    "Active Study Space (the student's dedicated workspace for this subject):\n"
)


def _parts(profile, space):
    return {p["part"]: p for p in prompt_trace.explain(profile, space)}


def _texts(profile, space):
    return [
        prompts.build_identity_block(profile),
        prompts.build_personalization_block(profile),
        prompts.build_space_block(space),
    ]


def _joined(part):
    return "\n".join(line["line"] for line in part["lines"])


class TestExplain:
    def test_the_builders_are_the_unmodified_ones(self):
        # Nothing about the breakdown lives in the prompts package.
        assert not hasattr(prompts, "explain_personalization")
        assert not hasattr(personalization, "explain_personalization")
        assert not hasattr(personalization, "_profile_lines")

    def test_parts_are_in_prompt_order_and_account_for_every_char(self):
        parts = prompt_trace.explain(PROFILE, SPACE)
        assert [p["part"] for p in parts] == [
            "identity",
            "learning_profile",
            "study_space",
        ]
        assert [p["label"] for p in parts] == [
            "Student identity",
            "Learning profile",
            "Study Space",
        ]
        assert all(p["included"] for p in parts)
        assert [p["text"] for p in parts] == _texts(PROFILE, SPACE)
        assert sum(p["chars"] for p in parts) == len(
            "".join(_texts(PROFILE, SPACE))
        )

    def test_identity_names_the_account_name(self):
        identity = _parts(PROFILE, SPACE)["identity"]
        assert identity["lines"] == [
            {"source": "profile.full_name", "line": "Student's name: Asha"}
        ]
        assert "even if onboarding was skipped" in identity["reason"]
        # A name that also occurs in the fixed wording is still found.
        short = _parts({"full_name": " S "}, None)["identity"]
        assert short["lines"][0]["line"] == "Student's name: S"

    def test_each_profile_line_names_its_user_detail(self):
        profile = _parts(PROFILE, SPACE)["learning_profile"]
        assert profile["lines"] == [
            {
                "source": "profile.preferred_language",
                "line": "- Preferred Language: Hinglish",
            },
            {
                "source": "profile.ai_personality",
                "line": "- Assistant Persona: Study Buddy",
            },
            {
                "source": "profile.education_level",
                "line": "- Education Level: Class 12",
            },
            {
                "source": "profile.favorite_subjects",
                "line": "- Favorite Subjects: Biology, Chemistry",
            },
            {
                "source": "profile.learning_traits.likes_funny_examples",
                "line": "- Enjoys funny examples and analogies",
            },
            {
                "source": "profile.learning_traits.preferred_depth",
                "line": "- Preferred Depth: deep",
            },
            {
                "source": "profile.custom_instructions",
                "line": '- Custom Instructions: "Keep it short"',
            },
        ]
        # A trait that exists but is off is reported as not added.
        assert profile["ignored"] == [
            {
                "source": "profile.learning_traits.likes_visual_explanations",
                "reason": "This trait is not switched on.",
            }
        ]
        assert profile["rules_chars"] == len(personalization._INSTRUCTION)
        assert "every filled profile field" in profile["reason"]
        block = prompts.build_personalization_block(PROFILE)
        assert block == (
            PROFILE_HEAD
            + _joined(profile)
            + "\n\n"
            + personalization._INSTRUCTION
        )

    def test_lines_follow_the_builder_order_not_the_record_order(self):
        shuffled = dict(reversed(list(PROFILE.items())))
        assert (
            _parts(shuffled, None)["learning_profile"]["lines"]
            == _parts(PROFILE, None)["learning_profile"]["lines"]
        )

    def test_switched_off_traits_are_listed_in_builder_order(self):
        profile = {
            "personalization_status": "completed",
            "preferred_language": "Hindi",
            "learning_traits": {
                "wants_concept_check_questions": False,
                "unknown_trait": False,
                "likes_funny_examples": "yes",
                "preferred_depth": "",
            },
        }
        ignored = _parts(profile, None)["learning_profile"]["ignored"]
        assert [item["source"] for item in ignored] == [
            "profile.learning_traits.likes_funny_examples",
            "profile.learning_traits.wants_concept_check_questions",
        ]

    def test_onboarding_not_completed_keeps_only_the_language(self):
        pending = {**PROFILE, "personalization_status": "pending"}
        profile = _parts(pending, None)["learning_profile"]
        assert profile["included"] is True
        assert "only the preferred language applies" in profile["reason"]
        assert "'pending'" in profile["reason"]
        assert profile["lines"] == [
            {
                "source": "profile.preferred_language",
                "line": "- Preferred Language: Hinglish",
            }
        ]
        assert [item["source"] for item in profile["ignored"]] == [
            "profile.ai_personality",
            "profile.education_level",
            "profile.favorite_subjects",
            "profile.learning_traits.likes_funny_examples",
            "profile.learning_traits.preferred_depth",
            "profile.custom_instructions",
        ]
        assert {item["reason"] for item in profile["ignored"]} == {
            "Onboarding is not completed."
        }
        block = prompts.build_personalization_block(pending)
        assert all(item["line"] not in block for item in profile["ignored"])

    def test_a_language_the_builder_accepts_is_explained_as_it_prints_it(
        self,
    ):
        # Before onboarding the builder prints any truthy language value.
        profile = {"preferred_language": 5, "personalization_status": None}
        part = _parts(profile, None)["learning_profile"]
        assert part["text"].startswith(
            "User Learning Profile:\n- Preferred Language: 5\n"
        )
        assert part["lines"] == [
            {
                "source": "profile.preferred_language",
                "line": "- Preferred Language: 5",
            }
        ]

    def test_nothing_added_says_why(self):
        parts = _parts({"personalization_status": "pending"}, None)
        assert not any(p["included"] for p in parts.values())
        assert all(p["lines"] == [] for p in parts.values())
        assert "no name" in parts["identity"]["reason"]
        assert "no preferred language" in parts["learning_profile"]["reason"]
        assert "not in a Study Space" in parts["study_space"]["reason"]
        assert _parts(None, {"name": "General", "is_default": True})[
            "study_space"
        ]["reason"].startswith("The session is in the default General space")
        assert (
            "has no name"
            in (_parts(None, {"subject": "Bio"})["study_space"]["reason"])
        )
        assert (
            "No profile row" in _parts(None, None)["learning_profile"]["reason"]
        )
        empty = _parts({"personalization_status": "completed"}, None)
        assert (
            "no profile field is filled"
            in (empty["learning_profile"]["reason"])
        )
        assert "rules_chars" not in empty["learning_profile"]

    def test_space_lines_name_their_fields(self):
        space = _parts(PROFILE, SPACE)["study_space"]
        assert space["lines"] == [
            {"source": "space.name", "line": "- Space: Cells"},
            {"source": "space.subject", "line": "- Subject: Biology"},
            {
                "source": "space.settings.memory.recent_quizzes",
                "line": "- Recent quiz results: Mitosis (60%)",
            },
            {
                "source": "space.settings.memory.weak_topics",
                "line": "- Topics the student is struggling with: Meiosis",
            },
        ]
        block = prompts.build_space_block(SPACE)
        assert block.startswith(SPACE_HEAD + _joined(space) + "\nAnchor")


class TestLearnedFromTheBuilders:
    """The breakdown follows the builders, not a copy of their rules."""

    def test_a_field_added_to_the_builder_is_attributed(self, monkeypatch):
        monkeypatch.setattr(
            personalization,
            "_FIELDS",
            [*personalization._FIELDS, ("nickname", "Nickname")],
        )
        profile = {**PROFILE, "nickname": "Ash"}
        lines = _parts(profile, None)["learning_profile"]["lines"]
        assert {"source": "profile.nickname", "line": "- Nickname: Ash"} in (
            lines
        )

    def test_a_relabelled_field_is_followed(self, monkeypatch):
        monkeypatch.setattr(
            personalization,
            "_TRAIT_LINES",
            {"likes_funny_examples": "Likes jokes"},
        )
        lines = _parts(PROFILE, None)["learning_profile"]["lines"]
        assert {
            "source": "profile.learning_traits.likes_funny_examples",
            "line": "- Likes jokes",
        } in lines

    def test_text_no_field_accounts_for_is_still_listed(self, monkeypatch):
        real = personalization.build_space_block

        def with_extra(space):
            text = real(space)
            if text and space.get("subject") and space.get("description"):
                return text.replace("\nAnchor", "\n- Both are set\nAnchor")
            return text

        monkeypatch.setattr(personalization, "build_space_block", with_extra)
        space = {"name": "Cells", "subject": "Bio", "description": "Notes"}
        part = _parts(None, space)["study_space"]
        assert part["text"] == with_extra(space)
        assert part["lines"][-1] == {
            "source": "space",
            "line": "- Both are set",
        }

    def test_a_builder_without_the_anchor_field_degrades(self, monkeypatch):
        monkeypatch.setattr(
            personalization,
            "build_personalization_block",
            lambda profile: "Profile: custom" if profile else "",
        )
        part = _parts(PROFILE, None)["learning_profile"]
        assert part["included"] is True
        assert part["text"] == "Profile: custom"
        assert part["lines"] == []
        assert "could not be read field by field" in part["reason"]


class TestNeverRaises:
    @pytest.mark.parametrize(
        "profile",
        [
            MagicMock(),
            {"full_name": MagicMock(), "learning_traits": MagicMock()},
            {1: "x", None: "y", "preferred_language": ["a"]},
            {"learning_traits": {"a": {"b": {"c": {"d": {"e": True}}}}}},
            {"personalization_status": "completed", "favorite_subjects": 7},
        ],
    )
    def test_odd_profiles(self, profile):
        parts = prompt_trace.explain(profile, None)
        assert [p["part"] for p in parts] == [
            "identity",
            "learning_profile",
            "study_space",
        ]
        assert [p["text"] for p in parts] == _texts(profile, None)

    def test_a_space_the_builder_itself_rejects(self):
        # ``settings`` must be a mapping for the real builder; the breakdown
        # reports the part as empty instead of raising.
        parts = prompt_trace.explain(None, {"name": "Cells", "settings": "x"})
        assert parts[2]["included"] is False
        assert parts[2]["lines"] == []

    def test_a_failing_builder(self, monkeypatch):
        def boom(_record):
            raise RuntimeError("builder bug")

        monkeypatch.setattr(personalization, "build_identity_block", boom)
        parts = prompt_trace.explain(PROFILE, SPACE)
        assert parts[0]["included"] is False
        assert parts[1]["included"] is True

    def test_a_very_wide_record_is_bounded(self):
        wide = {f"column_{i}": "x" for i in range(500)}
        wide.update(PROFILE)
        part = _parts(wide, None)["learning_profile"]
        assert part["text"] == prompts.build_personalization_block(wide)


# ------------------------------------------------------------------- fuzz

_VALUES = [
    None,
    "",
    "  ",
    "Hinglish",
    " Teacher ",
    "x\ny",
    5,
    ["a"],
    True,
    "S",
    "- Assistant Persona: Teacher",
    "A\n- Assistant Persona: B",
]
_PROFILE_KEYS = [
    "full_name",
    "preferred_language",
    "ai_personality",
    "communication_style",
    "education_level",
    "exam_target",
    "explanation_style",
    "learning_goal",
    "custom_instructions",
    "email",
]


def _random_profile(rnd: random.Random):
    if rnd.random() < 0.05:
        return rnd.choice([None, {}])
    profile = {}
    for key in _PROFILE_KEYS:
        if rnd.random() < 0.7:
            profile[key] = rnd.choice(_VALUES)
    if rnd.random() < 0.8:
        profile["personalization_status"] = rnd.choice(
            ["completed", "completed", "pending", None, "skipped"]
        )
    if rnd.random() < 0.6:
        profile["favorite_subjects"] = rnd.choice(
            [None, [], ["Math"], ["Math", " ", "Bio"], "Math", [1, 2]]
        )
    if rnd.random() < 0.7:
        traits = {
            "likes_funny_examples": rnd.choice([True, False, "yes", None]),
            "likes_visual_explanations": rnd.choice([True, False]),
            "wants_concept_check_questions": rnd.choice([True, False, 1]),
            "preferred_depth": rnd.choice(["deep", "", None, 3]),
            "curiosity_level": rnd.choice(["high", " "]),
            "unknown": True,
        }
        items = list(traits.items())
        rnd.shuffle(items)
        items = items[: rnd.randint(0, len(items))]
        profile["learning_traits"] = rnd.choice([None, "x", {}, dict(items)])
    items = list(profile.items())
    rnd.shuffle(items)
    return dict(items)


def _random_space(rnd: random.Random):
    if rnd.random() < 0.2:
        return rnd.choice([None, {}])
    space = {}
    for key in ("name", "subject", "description", "id"):
        if rnd.random() < 0.8:
            space[key] = rnd.choice(
                [None, "", " Bio ", "Organic Chem", "x\ny", "- Subject: Bio", 7]
            )
    if rnd.random() < 0.5:
        space["is_default"] = rnd.choice([True, False, None])
    if rnd.random() < 0.7:
        memory = {
            "recent_quizzes": rnd.choice(
                [
                    None,
                    [],
                    [{"topic": "Cells", "score": 80}] * rnd.randint(1, 5),
                ]
            ),
            "weak_topics": rnd.choice([None, [], ["Mitosis", "Osmosis"]]),
        }
        space["settings"] = rnd.choice(
            [None, {}, {"memory": None}, {"theme": "dark", "memory": memory}]
        )
    return space


def test_breakdown_agrees_with_the_builders_for_random_records():
    rnd = random.Random(20260930)  # noqa: S311 — a reproducible fuzz.
    for _ in range(4000):
        profile, space = _random_profile(rnd), _random_space(rnd)
        parts = prompt_trace.explain(profile, space)
        texts = _texts(profile, space)
        for part, text in zip(parts, texts, strict=True):
            assert part["text"] == text
            assert part["included"] is bool(text)
            assert part["chars"] == len(text)
            sources = [line["source"] for line in part["lines"]]
            assert len(sources) == len(set(sources))
            # Every line is attributed to a field, never left as "unknown".
            assert not {"profile", "space"} & set(sources), (part, profile)
            assert bool(part["lines"]) is bool(text)
            for item in part["ignored"]:
                assert item["source"] not in sources
        _identity, learning, study = parts
        if learning["included"]:
            # Header + the explained lines + the fixed rules is the block.
            assert learning["text"] == (
                PROFILE_HEAD
                + _joined(learning)
                + "\n\n"
                + personalization._INSTRUCTION
            ), profile
            assert learning["rules_chars"] == len(personalization._INSTRUCTION)
        if study["included"]:
            assert study["text"].startswith(
                SPACE_HEAD + _joined(study) + "\nAnchor"
            ), space
