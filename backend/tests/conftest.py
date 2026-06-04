"""Pytest fixtures shared across the backend test suite.

Provides an autouse cleanup that purges any TEST_-prefixed seed
documents accumulated across runs, so the admin UI doesn't show
test rooms/categories/users from previous test sessions.
"""
from __future__ import annotations

import os
import re

import pytest
from pymongo import MongoClient


MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "smart_workplace")

# Match any document whose user-facing id-like field starts with TEST_,
# is exactly TEST, or whose name/email contains 'TEST_' / 'TEST-' / 'test+'.
# Also catches ESC_TEST_* and PYTEST_* used by iteration-3 tests.
_TEST_NAME_RE = re.compile(r"^(TEST_|ESC_TEST_|ESC_FRESH_|PYTEST_|test_).*", re.IGNORECASE)
_TEST_EMAIL_RE = re.compile(r"(^test_|@test\.local$|\+test@)", re.IGNORECASE)

CLEANUP_COLLECTIONS = {
    "rooms": ["id", "name"],
    "categories": ["id", "name"],
    "departments": ["id", "name"],
    "users": ["id", "email", "name"],
    "requests": ["id", "room_name", "category_name", "note"],
    "visitors": ["id", "name"],
    "menu_items": ["id", "name"],
    "preorders": ["id", "room_name"],
    "iot_commands": ["id", "room_name"],
    "routing_rules": ["id"],
    "failed_dispatches": ["id", "event"],
}


def _purge_test_docs(db) -> dict:
    """Delete any docs in known collections that look test-created.

    Returns a dict of collection -> deleted count for visibility.
    """
    deleted: dict = {}
    for coll, fields in CLEANUP_COLLECTIONS.items():
        or_clauses: list[dict] = []
        for f in fields:
            if f == "email":
                or_clauses.append({f: {"$regex": _TEST_EMAIL_RE}})
            else:
                or_clauses.append({f: {"$regex": _TEST_NAME_RE}})
        try:
            res = db[coll].delete_many({"$or": or_clauses})
            if res.deleted_count:
                deleted[coll] = res.deleted_count
        except Exception:
            pass
    return deleted


@pytest.fixture(autouse=True, scope="session")
def _cleanup_test_seed_leftovers():
    """Autouse session-scoped fixture: purge TEST_-prefixed docs before and after the suite."""
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    pre = _purge_test_docs(db)
    if pre:
        print(f"\n[conftest] pre-test cleanup removed: {pre}")
    yield
    post = _purge_test_docs(db)
    if post:
        print(f"\n[conftest] post-test cleanup removed: {post}")
    client.close()
