"""Super Admin panel: internal management and debugging tools.

This domain is deliberately decoupled from normal user auth. It is reached
through a secret frontend route but never trusts that route for access
control — every endpoint is guarded server-side by ``admin_required`` (see
``admin_auth``), which verifies a dedicated admin JWT on every request.
"""
