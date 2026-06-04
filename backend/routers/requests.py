import uuid
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException

from core import db, sio, emit_scoped, get_current_user, now_utc, iso, dispatch_notification, scope_filter
from models import RequestCreate, RequestStatusUpdate, STATUS_TRANSITIONS

router = APIRouter()


async def _resolve_departments(category_id: str) -> list[str]:
    """Return the ordered list of department ids that should receive a request
    for this category. Falls back to the category's own department_id when no
    explicit routing rule exists."""
    rule = await db.routing_rules.find_one({"category_id": category_id})
    if rule:
        ids = list(rule.get("department_ids") or [])
        # Backward compat: rules created before multi-dept routing only have
        # `department_id`. Promote that into the list.
        if not ids and rule.get("department_id"):
            ids = [rule["department_id"]]
        # Dedup while preserving order
        out: list[str] = []
        for d in ids:
            if d and d not in out:
                out.append(d)
        if out:
            return out
    cat = await db.categories.find_one({"id": category_id})
    fallback = cat.get("department_id") if cat else None
    return [fallback] if fallback else []


@router.post("/requests")
async def create_request(payload: RequestCreate):
    """Public - kiosk creates after PIN entry. PIN re-checked against room."""
    room = await db.rooms.find_one({"id": payload.room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if not payload.pin or payload.pin != room.get("pin"):
        raise HTTPException(status_code=403, detail="Invalid room PIN")
    category = await db.categories.find_one({"id": payload.category_id}, {"_id": 0})
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    # Tenant safety: category must belong to the same location as the room
    if category.get("location_id") and room.get("location_id") and category["location_id"] != room["location_id"]:
        raise HTTPException(status_code=400, detail="Category does not belong to this room's location")
    department_ids = await _resolve_departments(payload.category_id)
    primary_dept = department_ids[0] if department_ids else None
    rule = await db.routing_rules.find_one({"category_id": payload.category_id})
    escalation_minutes = rule["escalation_minutes"] if rule else 15

    req_id = str(uuid.uuid4())
    ts = now_utc()
    doc = {
        "id": req_id, "room_id": room["id"], "room_name": room["name"],
        "category_id": category["id"], "category_name": category["name"],
        "category_icon": category.get("icon", "Coffee"),
        "category_color": category.get("color", "#0055FF"),
        # Primary department kept for backward compat + analytics drill-down
        "department_id": primary_dept,
        # Full multi-dept routing list — staff in ANY of these depts can see + claim
        "department_ids": department_ids,
        "priority": category.get("priority", "normal"),
        "location_id": room.get("location_id"),
        "note": payload.note or "", "status": "requested",
        "escalation_minutes": escalation_minutes,
        "created_at": iso(ts), "updated_at": iso(ts),
        "accepted_at": None, "in_progress_at": None,
        "delivered_at": None, "closed_at": None, "escalated_at": None,
        "history": [{"status": "requested", "at": iso(ts), "by": None, "note": payload.note or ""}],
        "assignee_id": None, "assignee_name": None,
    }
    await db.requests.insert_one(doc)
    doc.pop("_id", None)
    await emit_scoped("request:new", doc)
    await dispatch_notification("new_request", doc)
    return doc


@router.get("/requests")
async def list_requests(
    status: Optional[str] = None,
    department_id: Optional[str] = None,
    room_id: Optional[str] = None,
    location_id: Optional[str] = None,
    limit: int = 200,
    user: dict = Depends(get_current_user),
):
    q: Dict[str, Any] = dict(scope_filter(user, location_id))
    if status:
        q["status"] = status
    if department_id:
        # Match either the primary department or any of the multi-dept routing list
        q["$or"] = [
            {"department_id": department_id},
            {"department_ids": department_id},
        ]
    if room_id:
        q["room_id"] = room_id
    if user["role"] not in ("super_admin", "admin") and not department_id:
        # Non-admin staff: show requests where their dept appears in either field
        dept = user.get("department_id")
        if dept:
            q["$or"] = [
                {"department_id": dept},
                {"department_ids": dept},
            ]
        else:
            q["department_id"] = "__no_dept__"
    return await db.requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.get("/requests/{req_id}")
async def get_request(req_id: str, user: dict = Depends(get_current_user)):
    out = await db.requests.find_one({"id": req_id}, {"_id": 0})
    if not out:
        raise HTTPException(status_code=404, detail="Not found")
    if user["role"] != "super_admin" and out.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location access not allowed")
    return out


@router.patch("/requests/{req_id}/status")
async def update_request_status(
    req_id: str, payload: RequestStatusUpdate, user: dict = Depends(get_current_user)
):
    req = await db.requests.find_one({"id": req_id})
    if not req:
        raise HTTPException(status_code=404, detail="Not found")
    if user["role"] != "super_admin" and req.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location update not allowed")
    status = payload.status
    current = req.get("status", "requested")
    allowed = STATUS_TRANSITIONS.get(current, [])
    is_admin = user["role"] in ("super_admin", "admin")
    if status not in allowed and not is_admin:
        raise HTTPException(status_code=400, detail=f"Cannot transition from {current} to {status}")

    ts = now_utc()
    update: Dict[str, Any] = {"status": status, "updated_at": iso(ts)}
    if status == "accepted":
        update["accepted_at"] = iso(ts)
        update["assignee_id"] = user["id"]
        update["assignee_name"] = user["name"]
    elif status == "in_progress":
        update["in_progress_at"] = iso(ts)
    elif status == "delivered":
        update["delivered_at"] = iso(ts)
    elif status == "closed":
        update["closed_at"] = iso(ts)
    elif status == "escalated":
        update["escalated_at"] = iso(ts)

    history_entry = {"status": status, "at": iso(ts), "by": user["name"], "note": payload.note or ""}
    await db.requests.update_one(
        {"id": req_id}, {"$set": update, "$push": {"history": history_entry}}
    )
    out = await db.requests.find_one({"id": req_id}, {"_id": 0})
    await emit_scoped("request:update", out)
    if status == "escalated":
        await dispatch_notification("escalated", out)
    return out


@router.get("/requests-public/{room_id}")
async def list_room_requests_public(room_id: str, limit: int = 20):
    return await db.requests.find(
        {"room_id": room_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
