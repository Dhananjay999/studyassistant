"""Image skills: registry integrity, selection, and prompt rendering."""

from unittest.mock import MagicMock

from flask import Flask

from aeva.llm import prompts
from aeva.mcp.base import RESPONSE_IMAGE, ToolContext
from aeva.mcp.tools.image_generator import ImageGeneratorTool


class TestRegistry:
    def test_ids_unique_and_default_present(self):
        ids = prompts.skill_ids()
        assert len(ids) == len(set(ids))
        assert "illustration" in ids
        for wanted in ("flowchart", "mind_map", "map", "line_art"):
            assert wanted in ids

    def test_params_enum_matches_registry(self):
        enum = prompts.IMAGE_GENERATION_PARAMS["properties"]["style"]["enum"]
        assert enum == prompts.skill_ids()

    def test_planner_lists_every_skill(self):
        listing = prompts.skills_for_planner()
        for skill_id in prompts.skill_ids():
            assert f"- {skill_id} — " in listing
        assert "{IMAGE_SKILLS}" in prompts.PLAN_TURN_TEMPLATE.user


class TestPickSkill:
    def test_explicit_style_wins(self):
        assert prompts.pick_skill("draw a cat", "mind_map").id == "mind_map"

    def test_unknown_style_falls_back_to_wording(self):
        assert prompts.pick_skill("flowchart of login", "nope").id == "flowchart"

    def test_wording(self):
        cases = {
            "draw a flowchart of the TCP handshake": "flowchart",
            "make a mind map of the French revolution": "mind_map",
            "concept map for photosynthesis": "mind_map",
            "black and white sketch of a neuron": "line_art",
            "diagram of the human heart": "labeled_diagram",
            "a colorful picture of the solar system": "illustration",
            "timeline of the Mughal empire": "timeline",
            "bar chart of rainfall by month": "chart",
            "map of India's rivers": "map",
            "realistic photo of a volcano": "photo_real",
            "comic strip about Newton's laws": "comic",
            "poster on water conservation": "infographic",
            "draw a cat": "illustration",
        }
        for text, expected in cases.items():
            assert prompts.pick_skill(text).id == expected, text

    def test_keywords_match_whole_words_only(self):
        # "mapping" must not trigger the map skill.
        assert prompts.pick_skill("draw gene mapping steps").id == "illustration"


class TestRendering:
    def test_every_skill_renders(self):
        for skill in prompts.IMAGE_SKILLS:
            text = ImageGeneratorTool.render_prompt("the water cycle", skill)
            assert skill.label in text
            assert skill.instructions in text
            assert "the water cycle" in text
            assert "{" not in text.replace("{", "", 0) or "SKILL" not in text

    def test_grounding_is_included(self):
        skill = prompts.pick_skill("x", "flowchart")
        text = ImageGeneratorTool.render_prompt("x", skill, "FACT: a -> b")
        assert "Ground the labels and facts" in text
        assert "FACT: a -> b" in text


class TestTool:
    def test_execute_uses_skill_and_aspect(self):
        llm = MagicMock()
        llm.model = "img"
        llm.generate_image.return_value = (b"png", "image/png", "")
        supabase = MagicMock()
        supabase.create_media_record.return_value = {
            "id": "m1",
            "file_name": "aeva-flowchart-tcp-handshake.png",
        }
        supabase.get_signed_url.return_value = "https://signed"
        tool = ImageGeneratorTool(llm=llm, supabase=supabase)
        notes: list[str] = []
        ctx = ToolContext(
            user_id="u", session_id="s",
            message="draw a flowchart of the TCP handshake",
            enriched_message="draw a flowchart of the TCP handshake",
            media_ids=None, report=notes.append,
        )
        with Flask(__name__).app_context():
            result = tool.execute(ctx, {"prompt": "TCP handshake", "title": "TCP handshake"})
        assert tool.response_type == RESPONSE_IMAGE
        assert result["style"] == "flowchart"
        assert result["images"][0]["style_label"] == "Flowchart"
        assert result["images"][0]["alt"] == "TCP handshake"
        assert "flowchart" in result["answer"].lower()
        assert llm.generate_image.call_args.kwargs["aspect"] == "portrait"
        sent = llm.generate_image.call_args.args[0]
        assert "Draw a clean flowchart" in sent
        name = supabase.create_media_record.call_args.kwargs["file_name"]
        assert name.startswith("aeva-flowchart-")
        assert notes == ["Drawing the flowchart…", "Saving to your library…"]

    def test_students_wording_beats_missing_style(self):
        llm = MagicMock()
        llm.model = "img"
        llm.generate_image.return_value = (b"png", "image/png", "A neuron.")
        supabase = MagicMock()
        supabase.create_media_record.return_value = {"id": "m", "file_name": "f"}
        tool = ImageGeneratorTool(llm=llm, supabase=supabase)
        ctx = ToolContext(
            user_id="u", session_id="s",
            message="black and white sketch of a neuron",
            enriched_message="x", media_ids=None,
        )
        with Flask(__name__).app_context():
            result = tool.execute(ctx, {"prompt": "a neuron with labels"})
        assert result["style"] == "line_art"
        assert result["answer"] == "A neuron."
