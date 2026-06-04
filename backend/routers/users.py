import re
import uuid
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query

from core import (
    db, hash_password, require_admin, get_current_user, ALLOWED_ROLES,
    now_utc, iso, scope_filter, resolve_target_location, can_write_at,
)
from routers.roles import is_role_allowed
from models import UserCreate, UserUpdate

router = APIRouter(prefix="/users")

_SAFE_PROJ = {"_id": 0, "password_hash": 0}
_SORTABLE = {"name", "email", "role", "created_at"}
# department_id / location_id are sortable but the visible *labels* are joined
# client-side, so sort by their raw id is fine and consistent.


@router.get("")
async def list_users(
    location_id: Optional[str] = Query(None),
    department_id: Optional[str] = Query(None),
    role: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Search by name or email (case-insensitive)"),
    sort: str = Query("name", description="Field to sort by"),
    order: str = Query("asc", regex="^(asc|desc)$"),
    user: dict = Depends(require_admin()),
):
    # Base location scoping (respects extras for non-super-admin)
    query = scope_filter(user, location_id)

    if department_id:
        query["department_id"] = department_id
    if role:
        query["role"] = role
    if q:
        rx = re.compile(re.escape(q.strip()), re.IGNORECASE)
        query["$or"] = [{"name": rx}, {"email": rx}]

    sort_field = sort if sort in _SORTABLE else "name"
    direction = 1 if order == "asc" else -1

    return await db.users.find(query, _SAFE_PROJ).sort(sort_field, direction).to_list(1000)


@router.post("")
async def create_user(payload: UserCreate, user: dict = Depends(require_admin())):
    if not await is_role_allowed(payload.role):
        raise HTTPException(status_code=400, detail="Invalid role")
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")

    # super_admin user has no location; everyone else must have a primary one
    target_loc: Optional[str] = None
    extras: List[str] = []
    if payload.role != "super_admin":
        target_loc = resolve_target_location(user, payload.location_id)
        # Extras only meaningful when there's a primary
        if payload.extra_location_ids:
            # Non-super-admin can't grant access to locations they themselves
            # can't reach (avoid privilege escalation).
            extras = _validate_extras(user, payload.extra_location_ids, target_loc)
            if user["role"] != "super_admin":
                _enforce_admin_scope(user, [target_loc, *extras])

    doc = {
        "id": str(uuid.uuid4()), "email": email, "name": payload.name,
        "role": payload.role, "department_id": payload.department_id,
        "location_id": target_loc,
        "extra_location_ids": extras,
        "password_hash": hash_password(payload.password),
        "created_at": iso(now_utc()),
    }
    await db.users.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in ("_id", "password_hash")}


@router.patch("/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, user: dict = Depends(require_admin())):
    existing = await db.users.find_one({"id": user_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")

    # Non-super-admin can only mutate users in their primary location
    if not can_write_at(user, existing.get("location_id")):
        raise HTTPException(status_code=403, detail="Cross-location update not allowed")

    update = {}
    if payload.name is not None:
        update["name"] = payload.name
    if payload.role is not None:
        if not await is_role_allowed(payload.role):
            raise HTTPException(status_code=400, detail="Invalid role")
        update["role"] = payload.role
    if payload.department_id is not None:
        update["department_id"] = payload.department_id
    if payload.password:
        update["password_hash"] = hash_password(payload.password)

    # Location moves
    new_primary = existing.get("location_id")
    if payload.location_id is not None and user["role"] == "super_admin":
        update["location_id"] = payload.location_id
        new_primary = payload.location_id

    if payload.extra_location_ids is not None:
        extras = _validate_extras(user, payload.extra_location_ids, new_primary)
        if user["role"] != "super_admin":
            _enforce_admin_scope(user, extras)
        update["extra_location_ids"] = extras

    if update:
        await db.users.update_one({"id": user_id}, {"$set": update})
    return await db.users.find_one({"id": user_id}, _SAFE_PROJ)


@router.delete("/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_admin())):
    existing = await db.users.find_one({"id": user_id})
    if existing and not can_write_at(user, existing.get("location_id")):
        raise HTTPException(status_code=403, detail="Cross-location delete not allowed")
    await db.users.delete_one({"id": user_id})
    return {"ok": True}


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _validate_extras(actor: dict, extras: List[str], primary: Optional[str]) -> List[str]:
    """De-dup + drop the primary from the extras list to keep them disjoint."""
    out: List[str] = []
    seen = set()
    for x in extras:
        if not x or x in seen:
            continue
        if x == primary:
            # Don't list primary as extra
            continue
        seen.add(x)
        out.append(x)
    return out


def _enforce_admin_scope(actor: dict, location_ids: List[str]) -> None:
    """Non-super-admins can only attach a user to locations they themselves
    can access (no privilege escalation)."""
    from core import accessible_location_ids
    accessible = set(accessible_location_ids(actor))
    for lid in location_ids:
        if lid and lid not in accessible:
            raise HTTPException(
                status_code=403,
                detail="Cannot assign user to a location outside your access",
            )
