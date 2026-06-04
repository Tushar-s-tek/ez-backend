import uuid
import os
import random
import string
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

from core import db, get_current_user, require_admin, now_utc, iso, gen_pin, gen_qr_data_url, scope_filter, resolve_target_location
from models import RoomCreate, RoomUpdate, RoomPinAuth

router = APIRouter(prefix="/rooms")

# Tiny URL alphabet — lowercase + digits, with visually ambiguous chars removed
# (no 0/o/1/l) so people can type the code from a printed sticker without
# squinting. 32 chars × 4 positions = ~1M combinations — plenty for any tenant.
_SHORT_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"
_SHORT_LEN = 4


def _qr_payload_for(pin: str, short_code: Optional[str] = None) -> str:
    """Returns the URL to embed in the room's QR code.

    Prefers the short form `<frontend>/r/<code>` when a short_code is known so
    phones / printed signs use the tiniest possible URL. Falls back to the
    full PIN path when no code exists (legacy rows pre-shortener)."""
    frontend = os.environ.get("FRONTEND_URL", "").rstrip("/")
    path = f"/r/{short_code}" if short_code else f"/room/{pin}"
    return f"{frontend}{path}" if frontend else path


async def _gen_unique_short_code() -> str:
    for _ in range(50):
        code = "".join(random.choices(_SHORT_ALPHABET, k=_SHORT_LEN))
        existing = await db.rooms.find_one({"short_code": code})
        if not existing:
            return code
    raise HTTPException(status_code=500, detail="Could not allocate unique short code")


@router.get("")
async def list_rooms(location_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = scope_filter(user, location_id)
    return await db.rooms.find(q, {"_id": 0}).to_list(1000)


async def _gen_unique_pin() -> str:
    """Generate a globally unique 6-digit PIN (kiosk URL /room/{pin} must
    resolve to exactly one room, even across locations)."""
    for _ in range(50):
        pin = gen_pin()
        existing = await db.rooms.find_one({"pin": pin})
        if not existing:
            return pin
    raise HTTPException(status_code=500, detail="Could not allocate unique PIN")


@router.post("")
async def create_room(payload: RoomCreate, user: dict = Depends(require_admin())):
    loc = resolve_target_location(user, payload.location_id)
    room_id = str(uuid.uuid4())
    pin = await _gen_unique_pin()
    short_code = await _gen_unique_short_code()
    qr_payload = _qr_payload_for(pin, short_code)
    doc = {
        "id": room_id, "name": payload.name, "floor": payload.floor,
        "location": payload.location, "department_id": payload.department_id,
        "location_id": loc,
        "pin": pin, "short_code": short_code,
        "qr_payload": qr_payload, "qr_image": gen_qr_data_url(qr_payload),
        "created_at": iso(now_utc()),
    }
    await db.rooms.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/{room_id}")
async def update_room(room_id: str, payload: RoomUpdate, user: dict = Depends(require_admin())):
    existing = await db.rooms.find_one({"id": room_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if user["role"] != "super_admin" and existing.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location update not allowed")
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if update:
        await db.rooms.update_one({"id": room_id}, {"$set": update})
    return await db.rooms.find_one({"id": room_id}, {"_id": 0})


@router.post("/{room_id}/regenerate-pin")
async def regenerate_pin(room_id: str, user: dict = Depends(require_admin())):
    existing = await db.rooms.find_one({"id": room_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if user["role"] != "super_admin" and existing.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location update not allowed")
    pin = await _gen_unique_pin()
    # Regenerate the short code too so old printed stickers can't keep
    # routing to a room whose PIN has changed.
    short_code = await _gen_unique_short_code()
    qr_payload = _qr_payload_for(pin, short_code)
    qr_image = gen_qr_data_url(qr_payload)
    await db.rooms.update_one(
        {"id": room_id},
        {"$set": {
            "pin": pin, "short_code": short_code,
            "qr_payload": qr_payload, "qr_image": qr_image,
        }},
    )
    return await db.rooms.find_one({"id": room_id}, {"_id": 0})


@router.post("/rebuild-qr")
async def rebuild_all_qr(_: dict = Depends(require_admin())):
    updated = 0
    async for room in db.rooms.find({}):
        pin = room.get("pin")
        if not pin:
            continue
        # Backfill: every room must have a short_code so its QR is the tiny form.
        short_code = room.get("short_code")
        if not short_code:
            short_code = await _gen_unique_short_code()
        qr_payload = _qr_payload_for(pin, short_code)
        qr_image = gen_qr_data_url(qr_payload)
        await db.rooms.update_one(
            {"id": room["id"]},
            {"$set": {
                "short_code": short_code,
                "qr_payload": qr_payload,
                "qr_image": qr_image,
            }},
        )
        updated += 1
    return {"updated": updated}


@router.get("/by-short/{short_code}")
async def get_room_by_short_code(short_code: str):
    """Public — kiosk short URL resolver. Returns the room's PIN + location
    so the frontend `/r/:code` route can navigate to `/room/:pin`."""
    room = await db.rooms.find_one({"short_code": short_code.lower()}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Unknown short code")
    return {"pin": room.get("pin"), "location_id": room.get("location_id"), "name": room.get("name")}


@router.delete("/{room_id}")
async def delete_room(room_id: str, user: dict = Depends(require_admin())):
    existing = await db.rooms.find_one({"id": room_id})
    if existing and user["role"] != "super_admin" and existing.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location delete not allowed")
    await db.rooms.delete_one({"id": room_id})
    return {"ok": True}


@router.post("/access")
async def room_access(payload: RoomPinAuth):
    """Public - kiosk PIN entry. Includes the room's location_id so the
    kiosk can fetch categories/menu/etc scoped to its tenant."""
    room = await db.rooms.find_one({"pin": payload.pin}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Invalid PIN")
    return room
