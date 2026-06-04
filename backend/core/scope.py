"""Location scoping helper.

Centralises the rule:
  - super_admin can pass ?location_id= to override (or omit for all-locations view)
  - other users are scoped to their PRIMARY location_id (writes) but may also READ
    from any location in their `extra_location_ids`.
"""
from __future__ import annotations
from typing import Optional, Dict, Any, List
from fastapi import HTTPException


def accessible_location_ids(user: dict) -> List[str]:
    """Return the list of locations this user can READ from (primary + extras)."""
    out: List[str] = []
    primary = user.get("location_id")
    if primary:
        out.append(primary)
    for extra in (user.get("extra_location_ids") or []):
        if extra and extra not in out:
            out.append(extra)
    return out


def scope_filter(user: dict, location_id: Optional[str] = None) -> Dict[str, Any]:
    """Return a Mongo query fragment that scopes a LIST to the right location(s).

    Read semantics:
      - super_admin: optionally filter by location_id, else all
      - other users: filter by primary + extra_location_ids (union)
      - if location_id explicitly requested by a non-super_admin, must be one
        of their accessible locations
    """
    if user["role"] == "super_admin":
        if location_id:
            return {"location_id": location_id}
        return {}

    accessible = accessible_location_ids(user)
    if not accessible:
        # Non-super-admin with no location is a misconfiguration
        return {"location_id": "__no_location__"}

    if location_id:
        if location_id not in accessible:
            raise HTTPException(status_code=403, detail="You can only access your own location(s)")
        return {"location_id": location_id}

    if len(accessible) == 1:
        return {"location_id": accessible[0]}
    return {"location_id": {"$in": accessible}}


def resolve_target_location(user: dict, requested_location_id: Optional[str]) -> str:
    """When CREATING a resource, decide which location_id to attach.

    - non-super-admin: forced to their PRIMARY location (extras don't grant write)
    - super_admin:     uses requested, else None (must be provided for tenant resources)
    """
    if user["role"] != "super_admin":
        loc = user.get("location_id")
        if not loc:
            raise HTTPException(status_code=400, detail="Your user has no location assigned")
        return loc
    if not requested_location_id:
        raise HTTPException(status_code=400, detail="location_id is required for super_admin creating this resource")
    return requested_location_id


def can_write_at(user: dict, location_id: Optional[str]) -> bool:
    """Whether the user can MUTATE a resource at the given location_id.

    - super_admin: always yes
    - other roles: only if location_id == primary
    """
    if user["role"] == "super_admin":
        return True
    return bool(location_id) and user.get("location_id") == location_id
