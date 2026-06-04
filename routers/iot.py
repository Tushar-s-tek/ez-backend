import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

from core import db, sio, emit_scoped, get_current_user, now_utc, iso, logger, scope_filter
from models import IoTCommand

router = APIRouter(prefix="/iot")


@router.post("/command")
async def iot_command(payload: IoTCommand):
    """Public - kiosk sends device commands; logged + broadcast as iot:command socket event."""
    room = await db.rooms.find_one({"id": payload.room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if payload.pin != room.get("pin"):
        raise HTTPException(status_code=403, detail="Invalid PIN")
    doc = {
        "id": str(uuid.uuid4()), "room_id": room["id"], "room_name": room["name"],
        "location_id": room.get("location_id"),
        "device": payload.device, "action": payload.action,
        "created_at": iso(now_utc()),
    }
    await db.iot_commands.insert_one(doc)
    doc.pop("_id", None)
    await emit_scoped("iot:command", doc)
    logger.info("IoT %s/%s @ %s", payload.device, payload.action, room["name"])
    return doc


@router.get("/commands")
async def list_iot_commands(
    location_id: Optional[str] = None,
    limit: int = 100,
    user: dict = Depends(get_current_user),
):
    q = scope_filter(user, location_id)
    return await db.iot_commands.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
