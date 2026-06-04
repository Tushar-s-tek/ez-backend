"""Locations: tenant-level resource. Super-admin/admin only."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core import db, get_current_user, require_admin, now_utc, iso, accessible_location_ids
from models import LocationCreate, LocationUpdate
from seed import seed_location_defaults

router = APIRouter(prefix="/locations")


@router.get("")
async def list_locations(user: dict = Depends(get_current_user)):
    """Anyone authenticated can list locations (needed for switcher UI).

    Non-super-admin users see their primary location PLUS any extras they have
    been granted read access to.
    """
    if user["role"] == "super_admin":
        return await db.locations.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    accessible = accessible_location_ids(user)
    if not accessible:
        return []
    return await db.locations.find({"id": {"$in": accessible}}, {"_id": 0}).sort("name", 1).to_list(100)


@router.post("")
async def create_location(payload: LocationCreate, _: dict = Depends(require_admin())):
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = iso(now_utc())
    await db.locations.insert_one(doc)
    doc.pop("_id", None)
    # Seed default catalog (departments + categories + routing + menu) so the
    # new location works out of the box. Admin can add/edit/remove later.
    summary = await seed_location_defaults(doc["id"])
    doc["seeded"] = summary
    return doc


@router.patch("/{loc_id}")
async def update_location(loc_id: str, payload: LocationUpdate, _: dict = Depends(require_admin())):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if update:
        await db.locations.update_one({"id": loc_id}, {"$set": update})
    return await db.locations.find_one({"id": loc_id}, {"_id": 0})


@router.delete("/{loc_id}")
async def delete_location(
    loc_id: str,
    cascade: bool = False,
    _: dict = Depends(require_admin()),
):
    """Delete a location.

    - Without `cascade`: refuses if any tenant resource still belongs to this location.
    - With `cascade=true`: also deletes ALL its rooms / categories / departments /
      users / menu_items / routing_rules / requests / preorders / visitors / iot_commands
      / settings overrides. Irreversible.
    """
    child_colls = (
        "rooms", "categories", "departments", "users", "menu_items", "routing_rules",
        "requests", "preorders", "visitors", "iot_commands",
    )
    if not cascade:
        for coll in ("rooms", "categories", "departments", "users", "menu_items", "routing_rules"):
            count = await db[coll].count_documents({"location_id": loc_id})
            if count > 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Location still has {count} {coll} — pass ?cascade=true to also delete them.",
                )
    else:
        for coll in child_colls:
            await db[coll].delete_many({"location_id": loc_id})
        await db.settings.delete_one({"id": f"loc_{loc_id}"})
    await db.locations.delete_one({"id": loc_id})
    return {"ok": True}
