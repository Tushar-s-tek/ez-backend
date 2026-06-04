"""Roles router — exposes the union of built-in + custom roles.

Built-in roles (`ALLOWED_ROLES` in core.auth) cover the canonical workflows:
super_admin, admin, reception, cafeteria, it_support, facilities, security.

Admins can add additional roles via POST /api/roles. Custom roles are stored
in the `custom_roles` collection and behave like a "generic staff" role for
permission purposes — they can be assigned to users, will receive routed
requests via their department, but won't unlock any special admin powers.
"""
import re
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core import db, require_admin, ALLOWED_ROLES, now_utc, iso
from pydantic import BaseModel, Field

router = APIRouter(prefix="/roles")


class RoleCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=60)


def _slugify(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    return s or "role"


async def is_role_allowed(role: str) -> bool:
    """Returns True if `role` is a built-in or a saved custom role."""
    if role in ALLOWED_ROLES:
        return True
    found = await db.custom_roles.find_one({"value": role})
    return bool(found)


@router.get("")
async def list_roles(user: dict = Depends(require_admin())) -> List[dict]:
    """Return built-in roles + custom roles, both with {value, label, builtin}."""
    builtin = [
        {"value": "super_admin", "label": "Super Admin", "builtin": True},
        {"value": "admin", "label": "Admin", "builtin": True},
        {"value": "reception", "label": "Reception", "builtin": True},
        {"value": "cafeteria", "label": "Cafeteria", "builtin": True},
        {"value": "it_support", "label": "IT Support", "builtin": True},
        {"value": "facilities", "label": "Facilities", "builtin": True},
        {"value": "security", "label": "Security", "builtin": True},
    ]
    customs = await db.custom_roles.find({}, {"_id": 0}).to_list(200)
    for c in customs:
        c["builtin"] = False
    return builtin + customs


@router.post("")
async def create_role(payload: RoleCreate, user: dict = Depends(require_admin())) -> dict:
    label = payload.label.strip()
    value = _slugify(label)
    if value in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="Role already exists (built-in)")
    if await db.custom_roles.find_one({"value": value}):
        raise HTTPException(status_code=400, detail="Role already exists")
    doc = {
        "id": str(uuid.uuid4()),
        "value": value,
        "label": label,
        "created_at": iso(now_utc()),
        "created_by": user.get("id"),
    }
    await db.custom_roles.insert_one(doc)
    return {**{k: v for k, v in doc.items() if k != "_id"}, "builtin": False}
