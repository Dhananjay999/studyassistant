"""Media compression utilities."""

import io
import logging
from typing import Tuple

from flask import current_app
from PIL import Image

logger = logging.getLogger(__name__)

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}
ALLOWED_PDF_TYPE = "application/pdf"
MAX_IMAGE_DIMENSION = 2048
JPEG_QUALITY = 85
WEBP_QUALITY = 80


def compress_image(
    file_bytes: bytes,
    mime_type: str,
) -> Tuple[bytes, str]:
    """Compress and resize an image."""
    img = Image.open(io.BytesIO(file_bytes))

    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
        output_mime = "image/jpeg"
    else:
        output_mime = mime_type if mime_type != "image/gif" else "image/jpeg"
        if output_mime == "image/jpeg" and img.mode != "RGB":
            img = img.convert("RGB")

    width, height = img.size
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
        ratio = min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height)
        new_size = (int(width * ratio), int(height * ratio))
        img = img.resize(new_size, Image.Resampling.LANCZOS)

    buf = io.BytesIO()
    if output_mime == "image/webp":
        img.save(buf, format="WEBP", quality=WEBP_QUALITY, optimize=True)
    else:
        img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        output_mime = "image/jpeg"

    compressed = buf.getvalue()
    logger.info(
        "Compressed image: %d -> %d bytes",
        len(file_bytes),
        len(compressed),
    )
    return compressed, output_mime


def compress_pdf(file_bytes: bytes) -> bytes:
    """Basic PDF size check; return as-is if within limits."""
    max_bytes = current_app.config["MAX_UPLOAD_MB"] * 1024 * 1024
    if len(file_bytes) > max_bytes:
        msg = f"PDF exceeds max size of {current_app.config['MAX_UPLOAD_MB']}MB"
        raise ValueError(msg)
    return file_bytes


def compress_media(
    file_bytes: bytes,
    mime_type: str,
) -> Tuple[bytes, str]:
    """Compress media based on type."""
    max_bytes = current_app.config["MAX_UPLOAD_MB"] * 1024 * 1024
    if len(file_bytes) > max_bytes * 2:
        msg = f"File exceeds max size of {current_app.config['MAX_UPLOAD_MB']}MB"
        raise ValueError(msg)

    if mime_type in ALLOWED_IMAGE_TYPES:
        return compress_image(file_bytes, mime_type)
    if mime_type == ALLOWED_PDF_TYPE:
        return compress_pdf(file_bytes), mime_type

    msg = f"Unsupported media type: {mime_type}"
    raise ValueError(msg)
