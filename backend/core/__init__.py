"""core package — re-exports for routers / seed.

This preserves the iteration-3 import surface (`from core import ...`)
while internally the code is grouped under db / auth / notify / utils.
"""
from .db import db, sio, mongo_client, logger, emit_scoped, SUPER_ROOM
from .utils import (
    now_utc, iso,
    hash_password, verify_password,
    gen_pin, gen_qr_data_url,
)
from .auth import (
    JWT_ALGORITHM, JWT_SECRET, ALLOWED_ROLES,
    create_access_token, get_current_user, require_roles, require_admin,
)
from .notify import get_settings, upsert_settings, dispatch_notification
from .scope import scope_filter, resolve_target_location, can_write_at, accessible_location_ids

__all__ = [
    "db", "sio", "mongo_client", "logger", "emit_scoped", "SUPER_ROOM",
    "now_utc", "iso",
    "hash_password", "verify_password",
    "gen_pin", "gen_qr_data_url",
    "JWT_ALGORITHM", "JWT_SECRET", "ALLOWED_ROLES",
    "create_access_token", "get_current_user", "require_roles", "require_admin",
    "get_settings", "upsert_settings", "dispatch_notification",
    "scope_filter", "resolve_target_location", "can_write_at", "accessible_location_ids",
]
