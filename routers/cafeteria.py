"""Cafeteria: Menu + Pre-orders."""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

from core import db, sio, emit_scoped, get_current_user, require_admin, now_utc, iso, dispatch_notification, scope_filter, resolve_target_location
from models import (
    MenuItemCreate, MenuItemUpdate, PreOrderCreate, PreOrderStatusUpdate,
    PREORDER_TRANSITIONS,
)

router = APIRouter()


# -------- Menu --------
@router.get("/menu")
async def list_menu(available_only: bool = False, location_id: Optional[str] = None):
    q = {}
    if available_only:
        q["available"] = True
    if location_id:
        q["location_id"] = location_id
    return await db.menu_items.find(q, {"_id": 0}).sort("category", 1).to_list(500)


@router.post("/menu")
async def create_menu_item(payload: MenuItemCreate, user: dict = Depends(require_admin())):
    loc = resolve_target_location(user, payload.location_id)
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["location_id"] = loc
    doc["created_at"] = iso(now_utc())
    await db.menu_items.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/menu/{mid}")
async def update_menu_item(mid: str, payload: MenuItemUpdate, user: dict = Depends(require_admin())):
    existing = await db.menu_items.find_one({"id": mid})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if user["role"] != "super_admin" and existing.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location update not allowed")
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if update:
        await db.menu_items.update_one({"id": mid}, {"$set": update})
    return await db.menu_items.find_one({"id": mid}, {"_id": 0})


@router.delete("/menu/{mid}")
async def delete_menu_item(mid: str, user: dict = Depends(require_admin())):
    existing = await db.menu_items.find_one({"id": mid})
    if existing and user["role"] != "super_admin" and existing.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location delete not allowed")
    await db.menu_items.delete_one({"id": mid})
    return {"ok": True}


# -------- Pre-orders --------
async def _cafeteria_department_id(location_id: str) -> str | None:
    """The Cafeteria department in a given location. Falls back to any
    department whose name contains 'cafeteria' (case-insensitive) so admins
    who renamed/translated it still get correct routing."""
    if not location_id:
        return None
    dept = await db.departments.find_one(
        {"location_id": location_id, "name": {"$regex": "cafeter", "$options": "i"}},
        {"_id": 0, "id": 1},
    )
    return dept["id"] if dept else None


@router.post("/preorders")
async def create_preorder(payload: PreOrderCreate):
    """Public - kiosk creates pre-order with PIN validation."""
    room = await db.rooms.find_one({"id": payload.room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if payload.pin != room.get("pin"):
        raise HTTPException(status_code=403, detail="Invalid PIN")
    total = sum(float(i.get("price", 0)) * int(i.get("qty", 1)) for i in payload.items)
    loc = room.get("location_id")
    # Resolve target departments from per-item routing. Each menu item can have
    # its own `department_ids` override; un-overridden items fall back to the
    # location's Cafeteria. The preorder gets the UNION of all targets so any
    # involved department can see/claim it.
    cafe_id = await _cafeteria_department_id(loc)
    item_ids = [i.get("menu_item_id") or i.get("id") for i in payload.items if (i.get("menu_item_id") or i.get("id"))]
    menu_routes: dict[str, list[str]] = {}
    if item_ids:
        async for m in db.menu_items.find({"id": {"$in": item_ids}}, {"_id": 0, "id": 1, "department_ids": 1}):
            menu_routes[m["id"]] = list(m.get("department_ids") or [])
    target_depts: list[str] = []
    for it in payload.items:
        iid = it.get("menu_item_id") or it.get("id")
        item_depts = menu_routes.get(iid) or []
        if not item_depts and cafe_id:
            item_depts = [cafe_id]
        for d in item_depts:
            if d and d not in target_depts:
                target_depts.append(d)
    if not target_depts and cafe_id:
        target_depts = [cafe_id]
    primary_dept = target_depts[0] if target_depts else None
    doc = {
        "id": str(uuid.uuid4()), "room_id": room["id"], "room_name": room["name"],
        "location_id": loc,
        # Routing target — every staff member whose department appears in this
        # list will be notified. Cafeteria stays the default for un-overridden
        # items; menu items with explicit `department_ids` extend the targets.
        "department_id": primary_dept,
        "department_ids": target_depts,
        "items": payload.items, "total": round(total, 2),
        "scheduled_for": payload.scheduled_for, "note": payload.note or "",
        "status": "pending", "created_at": iso(now_utc()),
    }
    await db.preorders.insert_one(doc)
    doc.pop("_id", None)
    await emit_scoped("preorder:new", doc)
    await dispatch_notification("preorder_new", doc)
    return doc


@router.get("/preorders")
async def list_preorders(location_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = dict(scope_filter(user, location_id))
    # Non-admin staff: only see preorders targeted at their own department.
    # This means cafeteria staff see them, reception/IT/etc. don't.
    if user["role"] not in ("super_admin", "admin"):
        dept = user.get("department_id")
        if dept:
            q["$or"] = [
                {"department_id": dept},
                {"department_ids": dept},
            ]
        else:
            q["department_id"] = "__no_dept__"
    return await db.preorders.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/preorders-public/{room_id}")
async def list_room_preorders_public(room_id: str, limit: int = 20):
    """Kiosk polling fallback — same room only, no auth."""
    return await db.preorders.find(
        {"room_id": room_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)


@router.patch("/preorders/{oid}/status")
async def update_preorder_status(oid: str, payload: PreOrderStatusUpdate, user: dict = Depends(get_current_user)):
    existing = await db.preorders.find_one({"id": oid})
    if not existing:
        raise HTTPException(status_code=404, detail="Pre-order not found")
    if user["role"] != "super_admin" and existing.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location update not allowed")
    allowed = PREORDER_TRANSITIONS.get(existing.get("status", "pending"), [])
    is_admin = user["role"] in ("super_admin", "admin")
    if payload.status not in allowed and not is_admin:
        raise HTTPException(status_code=400, detail=f"Cannot transition from {existing.get('status')} to {payload.status}")
    await db.preorders.update_one({"id": oid}, {"$set": {"status": payload.status, "updated_at": iso(now_utc())}})
    out = await db.preorders.find_one({"id": oid}, {"_id": 0})
    await emit_scoped("preorder:update", out)
    return out
