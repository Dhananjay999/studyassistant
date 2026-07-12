"""Generic sharing platform.

One share table, one URL scheme (``/share/{share_id}``), one API. Content
types plug in via resolvers (see ``resolvers.py``); adding a new shareable
resource means registering a resolver — never a new table or endpoint.
"""
