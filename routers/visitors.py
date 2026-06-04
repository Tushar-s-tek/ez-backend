import os
import uuid
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core import (
    db, emit_scoped, get_current_user, now_utc, iso, dispatch_notification,
    scope_filter, gen_pin, gen_qr_data_url, get_settings,
)
from models import VisitorCreate, VisitorStatusUpdate, VisitorSelfCheckin

router = APIRouter(prefix="/visitors")


def _checkin_url(pin: str) -> str:
    """Absolute URL embedded into the visitor QR code so a phone camera can
    open it from outside the app. Falls back to a relative path when no
    FRONTEND_URL is configured (dev only — phone cameras won't be able to
    follow it, so deploys should always set FRONTEND_URL)."""
    base = os.environ.get("FRONTEND_URL", "").rstrip("/")
    path = f"/visitors/checkin?pin={pin}"
    return f"{base}{path}" if base else path


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
async def _gen_unique_visitor_pin() -> str:
    """6-digit pin unique among ACTIVE visitors (waiting/notified/checked_in)."""
    for _ in range(50):
        pin = gen_pin()
        existing = await db.visitors.find_one({
            "pin": pin, "status": {"$in": ["waiting", "notified", "checked_in"]}
        })
        if not existing:
            return pin
    raise HTTPException(status_code=500, detail="Could not allocate visitor PIN")


def _mask_id(idn: Optional[str]) -> str:
    if not idn:
        return ""
    if len(idn) <= 4:
        return "•" * len(idn)
    return "•" * (len(idn) - 4) + idn[-4:]


def _list_safe(v: dict) -> dict:
    """Strip large/sensitive fields when returning a list."""
    out = {k: val for k, val in v.items() if k not in ("photo_data_url",)}
    out["id_number"] = _mask_id(v.get("id_number"))
    out["has_photo"] = bool(v.get("photo_data_url"))
    return out


async def _resolve_badge_hours(location_id: Optional[str]) -> float:
    s = await get_settings(location_id)
    try:
        h = float(s.get("visitor_badge_hours") or 8)
    except (TypeError, ValueError):
        h = 8.0
    return max(0.5, min(72.0, h))


# -----------------------------------------------------------------------------
# Walk-in (existing flow, kept for backward compat) — reception logs visitor
# -----------------------------------------------------------------------------
@router.post("")
async def create_visitor(payload: VisitorCreate):
    """Public-ish — reception desk creates a walk-in visitor entry."""
    room = await db.rooms.find_one({"id": payload.host_room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Host room not found")
    ts = iso(now_utc())
    badge_hours = await _resolve_badge_hours(room.get("location_id"))
    valid_until = iso(now_utc() + timedelta(hours=badge_hours))
    pin = await _gen_unique_visitor_pin()
    doc = {
        "id": str(uuid.uuid4()), "name": payload.name, "company": payload.company or "",
        "purpose": payload.purpose or "", "phone": payload.phone or "",
        "host_room_id": room["id"], "host_room_name": room["name"],
        "location_id": room.get("location_id"),
        "status": "waiting", "kind": "walk_in",
        "pin": pin, "id_number": payload.id_number or "",
        "expected_at": payload.expected_at,
        "valid_until": valid_until,
        "photo_data_url": None,
        "nda_signed_at": None, "nda_signed_name": None,
        "created_at": ts,
        "history": [{"status": "waiting", "at": ts}],
    }
    await db.visitors.insert_one(doc)
    doc.pop("_id", None)
    await emit_scoped("visitor:new", _list_safe(doc))
    await dispatch_notification("visitor_waiting", doc)
    return doc


# -----------------------------------------------------------------------------
# Pre-register an EXPECTED visitor (auth required)
# -----------------------------------------------------------------------------
@router.post("/pre-register")
async def pre_register_visitor(payload: VisitorCreate, user: dict = Depends(get_current_user)):
    """Host or reception pre-registers an expected visitor. Returns a PIN + QR
    the host can email/SMS the visitor. The visitor uses that PIN at the
    self-service kiosk to check themselves in."""
    room = await db.rooms.find_one({"id": payload.host_room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Host room not found")
    if user["role"] != "super_admin" and room.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location host not allowed")
    ts = iso(now_utc())
    badge_hours = await _resolve_badge_hours(room.get("location_id"))
    pin = await _gen_unique_visitor_pin()
    doc = {
        "id": str(uuid.uuid4()), "name": payload.name, "company": payload.company or "",
        "purpose": payload.purpose or "", "phone": payload.phone or "",
        "host_room_id": room["id"], "host_room_name": room["name"],
        "location_id": room.get("location_id"),
        "status": "expected", "kind": "pre_registered",
        "pin": pin, "id_number": "",
        "expected_at": payload.expected_at,
        "valid_until": iso(now_utc() + timedelta(hours=badge_hours)),
        "photo_data_url": None,
        "nda_signed_at": None, "nda_signed_name": None,
        "registered_by": user["name"],
        "created_at": ts,
        "history": [{"status": "expected", "at": ts, "by": user["name"]}],
    }
    await db.visitors.insert_one(doc)
    doc.pop("_id", None)
    await emit_scoped("visitor:new", _list_safe(doc))
    # Build QR for the check-in URL (frontend handles /visitors/checkin?pin=...)
    doc["checkin_qr"] = gen_qr_data_url(_checkin_url(pin))
    doc["checkin_url"] = _checkin_url(pin)
    return doc


# -----------------------------------------------------------------------------
# Public lookup by PIN (kiosk uses this to fetch visitor card before check-in)
# -----------------------------------------------------------------------------
@router.get("/lookup/{pin}")
async def lookup_visitor_by_pin(pin: str):
    v = await db.visitors.find_one(
        {"pin": pin, "status": {"$in": ["expected", "waiting", "notified"]}},
        {"_id": 0, "photo_data_url": 0, "id_number": 0, "history": 0},
    )
    if not v:
        raise HTTPException(status_code=404, detail="No active visitor with that PIN")
    # Attach NDA text (per-location override → global)
    s = await get_settings(v.get("location_id"))
    v["nda_text"] = s.get("nda_text") or ""
    v["nda_required"] = bool(s.get("nda_required"))
    return v


# -----------------------------------------------------------------------------
# Self check-in (public — protected by PIN)
# -----------------------------------------------------------------------------
@router.post("/self-checkin")
async def self_checkin(payload: VisitorSelfCheckin):
    v = await db.visitors.find_one({"pin": payload.pin})
    if not v:
        raise HTTPException(status_code=404, detail="Invalid visitor PIN")
    if v["status"] in ("checked_in", "checked_out", "blocked"):
        raise HTTPException(status_code=400, detail=f"Visitor already {v['status']}")
    # NDA enforcement (per-location)
    s = await get_settings(v.get("location_id"))
    if s.get("nda_required") and s.get("nda_text"):
        if not payload.nda_signed_name:
            raise HTTPException(status_code=400, detail="NDA must be accepted before check-in")
    ts = iso(now_utc())
    update = {
        "status": "checked_in",
        "updated_at": ts,
        "checked_in_at": ts,
        "id_number": payload.id_number or v.get("id_number", ""),
    }
    if payload.photo_data_url:
        update["photo_data_url"] = payload.photo_data_url
    if payload.nda_signed_name:
        update["nda_signed_at"] = ts
        update["nda_signed_name"] = payload.nda_signed_name
    await db.visitors.update_one(
        {"id": v["id"]},
        {"$set": update,
         "$push": {"history": {"status": "checked_in", "at": ts, "by": "self-checkin"}}},
    )
    out = await db.visitors.find_one({"id": v["id"]}, {"_id": 0})
    await emit_scoped("visitor:update", _list_safe(out))
    # Notify the host room (in-app) — same channel as walk-in
    await dispatch_notification("visitor_waiting", out)
    return out


# -----------------------------------------------------------------------------
# List + status update (staff)
# -----------------------------------------------------------------------------
@router.get("")
async def list_visitors(
    location_id: Optional[str] = None,
    status: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = scope_filter(user, location_id)
    if status:
        q["status"] = {"$in": status.split(",")}
    rows = await db.visitors.find(q, {"_id": 0, "photo_data_url": 0}).sort("created_at", -1).to_list(500)
    return [_list_safe(r) for r in rows]


@router.patch("/{vid}/status")
async def update_visitor_status(vid: str, payload: VisitorStatusUpdate, user: dict = Depends(get_current_user)):
    visitor = await db.visitors.find_one({"id": vid})
    if not visitor:
        raise HTTPException(status_code=404, detail="Not found")
    if user["role"] != "super_admin" and visitor.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location update not allowed")
    ts = iso(now_utc())
    extra = {}
    if payload.status == "checked_in":
        extra["checked_in_at"] = ts
    if payload.status == "checked_out":
        extra["checked_out_at"] = ts
    await db.visitors.update_one(
        {"id": vid},
        {"$set": {"status": payload.status, "updated_at": ts, **extra},
         "$push": {"history": {"status": payload.status, "at": ts, "by": user["name"]}}},
    )
    out = await db.visitors.find_one({"id": vid}, {"_id": 0})
    await emit_scoped("visitor:update", _list_safe(out))
    return _list_safe(out)


# -----------------------------------------------------------------------------
# Badge — full visitor record including photo for the printable badge view
# -----------------------------------------------------------------------------
@router.get("/badge-public/{pin}")
async def get_visitor_badge_public(pin: str):
    """Public — used by the self check-in kiosk to render the printable badge
    (the kiosk has no user account but already proved possession of the PIN)."""
    v = await db.visitors.find_one({"pin": pin}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Not found")
    if v["status"] != "checked_in":
        raise HTTPException(status_code=400, detail="Badge available only after check-in")
    v["badge_qr"] = gen_qr_data_url(_checkin_url(v.get("pin", "")))
    return v


@router.get("/badge/{vid}")
async def get_visitor_badge(vid: str, user: dict = Depends(get_current_user)):
    v = await db.visitors.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Not found")
    if user["role"] != "super_admin" and v.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location not allowed")
    s = await get_settings(v.get("location_id"))
    v["company_name"] = s.get("company_name") or ""
    # Include a QR with the PIN so kiosk can scan if needed (or for re-entry)
    v["badge_qr"] = gen_qr_data_url(_checkin_url(v.get("pin", "")))
    return v


# -----------------------------------------------------------------------------
# Public listing for kiosk: visitors waiting for a specific host room
# -----------------------------------------------------------------------------
@router.get("/room/{room_id}")
async def list_room_visitors(room_id: str):
    rows = await db.visitors.find(
        {"host_room_id": room_id, "status": {"$in": ["waiting", "notified", "expected"]}},
        {"_id": 0, "photo_data_url": 0, "id_number": 0, "history": 0},
    ).sort("created_at", -1).to_list(20)
    return rows
