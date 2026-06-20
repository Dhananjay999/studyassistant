"""Vercel serverless entry point.

Vercel zero-config detects files under ``api/`` as Python serverless functions
and installs ``requirements.txt``. ``vercel.json`` rewrites every path here so
Flask handles its own routing. ``app`` is the WSGI callable Vercel invokes.
"""

from aeva.app import create_app

app = create_app()
