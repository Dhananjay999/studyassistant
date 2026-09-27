"""Image generation contract: the prompt template + MCP parameters.

``IMAGE_TEMPLATE`` is the full prompt an image model receives. The chosen
skill (see ``image_skills``) supplies the format brief; the student's request
is the subject; ``{SOURCE_CONTEXT}`` optionally grounds labels and facts in
what an earlier agent of the same turn explained. Image models take no
system channel, so everything lives in the user channel.
"""

from typing import Any

from aeva.llm.prompts.builder import PromptTemplate
from aeva.llm.prompts.image_skills import skill_ids

IMAGE_TEMPLATE = PromptTemplate(
    name="image_generation",
    system="",
    user="""Create ONE image for a student's study notes.

FORMAT — {SKILL_LABEL}:
{SKILL_INSTRUCTIONS}

AVOID: {SKILL_AVOID}.

SUBJECT:
{USER_REQUEST}
{SOURCE_CONTEXT}
Rules for every image:
- A single image: no collage of unrelated pictures, no watermark, no signature, no border text.
- Any text inside the image must be short, large, and spelled correctly, in English unless the student asked for another language. Write each label letter by letter; never use gibberish or placeholder text.
- Facts, labels, and proportions must be accurate. When unsure of a label, leave it out rather than invent it.
- When the student's own style wishes in SUBJECT conflict with FORMAT, follow the student.
""",
    optional=("SOURCE_CONTEXT",),
)

# MCP tool input schema (what the planner fills in to call this tool).
IMAGE_GENERATION_PARAMS: dict[str, Any] = {
    "type": "object",
    "properties": {
        "prompt": {
            "type": "string",
            "description": (
                "Complete visual description of the image to generate: the "
                "subject, the labels to show, and any style the student "
                "asked for. Resolve references from the conversation so "
                "the prompt stands alone."
            ),
        },
        "style": {
            "type": "string",
            "enum": skill_ids(),
            "description": (
                "Visual format, chosen from the image formats listed in "
                "the planner rules."
            ),
        },
        "title": {
            "type": "string",
            "description": "Short caption for the image (at most 8 words).",
        },
    },
    "required": ["prompt"],
}
