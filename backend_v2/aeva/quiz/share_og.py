"""Dynamic Open Graph card (1200x630 PNG) for a shared quiz.

Rendered with Pillow (already a dependency). No bundled font file: Pillow's
``ImageFont.load_default(size=...)`` returns a scalable font. The card uses the
StudyAssistant brand gradient with the quiz title, topic, question count, and
difficulty -- the preview that appears when a share link is pasted into
WhatsApp, LinkedIn, X, etc.
"""

from __future__ import annotations

import io

from PIL import Image, ImageDraw, ImageFont

W = 1200
H = 630
MARGIN = 80
GRADIENT_MID = 0.5

# Brand palette (matches favicon.svg / --brand-*).
VIOLET = (124, 58, 237)
INDIGO = (79, 70, 229)
TEAL = (20, 184, 166)
WHITE = (255, 255, 255)

RGB = tuple[int, int, int]


def _font(size: int) -> ImageFont.FreeTypeFont:
    """Return the scalable default font at the given pixel size."""
    return ImageFont.load_default(size=size)


def _lerp(a: RGB, b: RGB, t: float) -> RGB:
    """Interpolate between two RGB colors."""
    return (
        round(a[0] + (b[0] - a[0]) * t),
        round(a[1] + (b[1] - a[1]) * t),
        round(a[2] + (b[2] - a[2]) * t),
    )


def _gradient() -> Image.Image:
    """Build a vertical violet -> indigo -> teal brand gradient."""
    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        if t < GRADIENT_MID:
            color = _lerp(VIOLET, INDIGO, t / GRADIENT_MID)
        else:
            color = _lerp(INDIGO, TEAL, (t - GRADIENT_MID) / GRADIENT_MID)
        draw.line([(0, y), (W, y)], fill=color)
    return img


def _wrap(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    max_w: int,
    max_lines: int,
) -> list[str]:
    """Greedy word-wrap to a pixel width, truncating with an ellipsis."""
    words = text.split()
    lines: list[str] = []
    line = ""
    truncated = False
    for word in words:
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= max_w or not line:
            line = trial
        else:
            lines.append(line)
            line = word
        if len(lines) == max_lines:
            truncated = True
            break
    if line and len(lines) < max_lines:
        lines.append(line)
    if truncated and lines:
        ell = "..."
        while lines[-1] and draw.textlength(lines[-1] + ell, font=font) > max_w:
            lines[-1] = lines[-1][:-1]
        lines[-1] = lines[-1].rstrip() + ell
    return lines


def _pill(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    text: str,
    font: ImageFont.FreeTypeFont,
) -> int:
    """Draw a rounded pill and return its right edge x."""
    pad_x = 22
    pad_y = 12
    tw = draw.textlength(text, font=font)
    top, bottom = font.getbbox(text)[1], font.getbbox(text)[3]
    w = tw + pad_x * 2
    h = (bottom - top) + pad_y * 2
    draw.rounded_rectangle([x, y, x + w, y + h], radius=h // 2, fill=WHITE)
    draw.text((x + pad_x, y + pad_y - top), text, font=font, fill=INDIGO)
    return int(x + w)


def _logo(draw: ImageDraw.ImageDraw, x: int, y: int, size: int) -> None:
    """Draw a white rounded square with a violet 4-point sparkle."""
    draw.rounded_rectangle(
        [x, y, x + size, y + size], radius=size * 0.26, fill=WHITE
    )
    cx = x + size / 2
    cy = y + size / 2
    r = size * 0.3
    draw.polygon(
        [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=VIOLET
    )
    ar = size * 0.11
    ax = x + size * 0.76
    ay = y + size * 0.26
    draw.polygon(
        [(ax, ay - ar), (ax + ar, ay), (ax, ay + ar), (ax - ar, ay)],
        fill=VIOLET,
    )


def render_quiz_og_png(
    title: str,
    topic: str,
    question_count: int,
    difficulty: str,
    *,
    is_exam: bool,
) -> bytes:
    """Build the share card and return PNG bytes."""
    img = _gradient()
    draw = ImageDraw.Draw(img)

    _logo(draw, MARGIN, 72, 64)
    draw.text((MARGIN + 84, 86), "StudyAssistant", font=_font(38), fill=WHITE)

    y = 196
    if topic:
        draw.text(
            (MARGIN, y), topic.upper(), font=_font(30), fill=(224, 224, 245)
        )
    y = 244

    title_font = _font(64)
    for line in _wrap(draw, title or "Quiz", title_font, W - MARGIN * 2, 3):
        draw.text((MARGIN, y), line, font=title_font, fill=WHITE)
        y += 76

    pill_font = _font(30)
    px = MARGIN
    py = H - MARGIN - 54
    label_type = "Exam" if is_exam else "Quiz"
    for text in (
        f"{question_count} Questions",
        (difficulty or "medium").capitalize(),
        label_type,
    ):
        px = _pill(draw, px, py, text, pill_font) + 16

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
