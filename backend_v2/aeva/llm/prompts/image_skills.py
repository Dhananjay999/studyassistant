"""Image generation skills: one visual format, done properly.

A request for "an image" covers very different deliverables — a flowchart
is judged by whether its arrows and decisions are readable, a mind map by
its branching, a line drawing by clean outlines. One generic "educational
illustration" prefix produced the same soft picture for all of them. Each
skill here is a concrete brief for one format: layout, labelling, palette,
and what to avoid.

The planner picks a skill id (``style``) from ``skills_for_planner()``; when
it doesn't, ``pick_skill`` matches the request's wording, and finally falls
back to the colourful illustration. Adding a format = one ``ImageSkill``
entry in ``IMAGE_SKILLS`` (order matters: the first keyword match wins, so
specific formats come before general ones).
"""

import re
from dataclasses import dataclass

ASPECT_SQUARE = "square"
ASPECT_LANDSCAPE = "landscape"
ASPECT_PORTRAIT = "portrait"


@dataclass(frozen=True)
class ImageSkill:
    """A brief for one visual format."""

    id: str
    label: str
    when_to_use: str
    instructions: str
    avoid: str
    aspect: str = ASPECT_SQUARE
    keywords: tuple[str, ...] = ()


IMAGE_SKILLS: tuple[ImageSkill, ...] = (
    ImageSkill(
        id="flowchart",
        label="Flowchart",
        when_to_use="processes, algorithms, step sequences, decisions",
        instructions=(
            "Draw a clean flowchart on a plain white background. Use "
            "rounded rectangles for steps, diamonds for decisions, and a "
            "clearly marked Start and End. Connect boxes with straight or "
            "right-angled arrows that never cross, and label every decision "
            "branch (Yes / No). Read top to bottom. One short phrase per "
            "box in large sans-serif text; two or three flat colours with "
            "high contrast."
        ),
        avoid=(
            "3D effects, decorative pictures, photographic textures, tiny "
            "text, crossing arrows, more than about twelve boxes"
        ),
        aspect=ASPECT_PORTRAIT,
        keywords=(
            "flowchart", "flow chart", "flow diagram", "process diagram",
            "workflow", "decision tree", "algorithm",
        ),
    ),
    ImageSkill(
        id="mind_map",
        label="Mind map",
        when_to_use="concept maps, topic overviews, revision maps",
        instructions=(
            "Draw a mind map: the central topic in a bold shape in the "
            "middle, main branches radiating outwards as curved lines, each "
            "main branch in its own colour with thinner sub-branches in the "
            "same colour. Labels of one to three words sit on the "
            "branches. Spread branches evenly around the centre so nothing "
            "overlaps; add a small simple icon to each main branch."
        ),
        avoid=(
            "long sentences, boxes in a grid, overlapping labels, more than "
            "seven main branches"
        ),
        aspect=ASPECT_LANDSCAPE,
        keywords=(
            "mind map", "mindmap", "concept map", "spider diagram",
            "brainstorm map", "topic map",
        ),
    ),
    ImageSkill(
        id="timeline",
        label="Timeline",
        when_to_use="events in order, history, eras, stages over time",
        instructions=(
            "Draw a horizontal timeline: one straight line with evenly "
            "spaced markers, running chronologically from left to right. "
            "Put the date or period above each marker and a short event "
            "label below it, with a small consistent icon per event. Use "
            "four to ten events and a clear title at the top."
        ),
        avoid=(
            "events out of order, crowded or overlapping labels, invented "
            "dates, decorative backgrounds"
        ),
        aspect=ASPECT_LANDSCAPE,
        keywords=(
            "timeline", "time line", "chronology", "chronological",
            "sequence of events",
        ),
    ),
    ImageSkill(
        id="infographic",
        label="Infographic",
        when_to_use="posters, one-page summaries, key facts at a glance",
        instructions=(
            "Design a vertical infographic poster: a bold title at the top, "
            "then three to six stacked sections, each with one simple icon "
            "and a one-line fact. Emphasise numbers in large type. Keep one "
            "icon style and one colour palette throughout, with generous "
            "spacing between sections."
        ),
        avoid=(
            "paragraphs of text, mixed illustration styles, clutter, tiny "
            "captions"
        ),
        aspect=ASPECT_PORTRAIT,
        keywords=(
            "infographic", "poster", "one-pager", "one pager",
            "cheat sheet", "fact sheet",
        ),
    ),
    ImageSkill(
        id="chart",
        label="Chart",
        when_to_use="bar, line or pie charts and graphs of data",
        instructions=(
            "Draw a clear chart. Choose the type that fits the data: bars "
            "to compare categories, a line for a trend over time, a pie for "
            "parts of a whole. Give it a title, labelled axes with units, "
            "and a legend only when there is more than one series. Use the "
            "exact values provided; if none were given, use round "
            "illustrative values and mark the chart 'illustrative'."
        ),
        avoid=(
            "3D charts, invented precise statistics, unlabelled axes, "
            "decorative gradients"
        ),
        aspect=ASPECT_LANDSCAPE,
        keywords=(
            "bar chart", "pie chart", "line graph", "line chart",
            "histogram", "chart", "graph", "plot",
        ),
    ),
    ImageSkill(
        id="map",
        label="Map",
        when_to_use="geographic or route maps, regions, locations",
        instructions=(
            "Draw a clean map in a simple cartographic style: clear borders "
            "and coastlines, flat region colours, and legible labels for "
            "the regions, cities, rivers or routes that matter to the "
            "request. Include a compass rose and a small legend. For a "
            "schematic or route map, show only the nodes and paths."
        ),
        avoid=(
            "satellite imagery, invented place names, labels over borders, "
            "excess detail unrelated to the request"
        ),
        aspect=ASPECT_LANDSCAPE,
        keywords=(
            "world map", "route map", "political map", "physical map",
            "map of", "map",
        ),
    ),
    ImageSkill(
        id="comic",
        label="Comic strip",
        when_to_use="stories, storyboards, explaining through characters",
        instructions=(
            "Draw a comic strip of three to six panels in clear reading "
            "order. Keep the same characters and art style in every panel, "
            "show one moment per panel, and use short speech bubbles with "
            "large legible text."
        ),
        avoid=(
            "long speech bubbles, inconsistent characters, crowded panels, "
            "unreadable lettering"
        ),
        aspect=ASPECT_LANDSCAPE,
        keywords=(
            "comic", "storyboard", "cartoon strip", "comic strip", "panels",
        ),
    ),
    ImageSkill(
        id="line_art",
        label="Black-and-white line drawing",
        when_to_use="black and white, sketches, outlines, printable art",
        instructions=(
            "Draw in pure black ink on a white background: clean outlines "
            "with a consistent stroke weight, no colour and no grey fills. "
            "Use simple hatching only where shading is essential. The "
            "drawing must print clearly and be easy to copy by hand."
        ),
        avoid="colour, gradients, grey shading, photographic detail",
        keywords=(
            "black and white", "black & white", "b&w", "line art",
            "line drawing", "monochrome", "pencil sketch", "sketch",
            "outline", "coloring page", "colouring page",
        ),
    ),
    ImageSkill(
        id="photo_real",
        label="Realistic image",
        when_to_use="realistic, photo-style pictures of real things",
        instructions=(
            "Create a realistic, photograph-like image with natural "
            "lighting, true-to-life colours and textures, and a clear "
            "single subject in focus."
        ),
        avoid="text overlays, cartoon styling, surreal distortions",
        keywords=(
            "photorealistic", "photo-realistic", "realistic", "lifelike",
            "photograph", "photo",
        ),
    ),
    ImageSkill(
        id="labeled_diagram",
        label="Labelled diagram",
        when_to_use="anatomy, structures, parts of a thing, apparatus",
        instructions=(
            "Draw a textbook-style labelled diagram on a plain light "
            "background with accurate shapes and proportions. Place every "
            "label outside the figure, connected by a thin straight leader "
            "line, with no label overlapping the drawing or another label. "
            "Use flat, muted colours to separate the parts."
        ),
        avoid=(
            "labels inside crowded areas, decorative backgrounds, "
            "inaccurate or invented parts"
        ),
        keywords=(
            "labelled", "labeled", "label", "diagram", "anatomy",
            "cross-section", "cross section", "structure of", "parts of",
            "schematic",
        ),
    ),
    ImageSkill(
        id="illustration",
        label="Colourful illustration",
        when_to_use="colourful pictures and general illustrations",
        instructions=(
            "Create a vibrant, friendly educational illustration in a clean "
            "flat-vector style with one clear focal subject, soft shading "
            "and a simple background. Add a few short labels only when "
            "they help understanding."
        ),
        avoid="clutter, dark muddy colours, walls of text",
        keywords=(
            "colourful", "colorful", "vibrant", "illustration", "illustrate",
            "cartoon", "picture", "image",
        ),
    ),
)

DEFAULT_SKILL_ID = "illustration"
_SKILLS_BY_ID = {skill.id: skill for skill in IMAGE_SKILLS}
_KEYWORD_RES = tuple(
    (
        skill,
        re.compile(
            r"(?<![a-z])(?:"
            + "|".join(re.escape(k) for k in skill.keywords)
            + r")(?![a-z])",
            re.IGNORECASE,
        ),
    )
    for skill in IMAGE_SKILLS
    if skill.keywords
)


def skill_ids() -> list[str]:
    """Every skill id, in registry order."""
    return [skill.id for skill in IMAGE_SKILLS]


def pick_skill(prompt: str, style: str | None = None) -> ImageSkill:
    """Resolve the skill for a request.

    An explicit, valid ``style`` (the planner's choice) wins; otherwise the
    first skill whose keywords appear in the prompt; otherwise the default.
    """
    if style and style in _SKILLS_BY_ID:
        return _SKILLS_BY_ID[style]
    for skill, pattern in _KEYWORD_RES:
        if pattern.search(prompt or ""):
            return skill
    return _SKILLS_BY_ID[DEFAULT_SKILL_ID]


def skills_for_planner() -> str:
    """One line per skill for the planner prompt (``id — when to use``)."""
    return "\n".join(
        f"  - {skill.id} — {skill.when_to_use}" for skill in IMAGE_SKILLS
    )
