"""DB client + Socket.IO singletons."""
from __future__ import annotations

import os
import logging

import socketio
from motor.motor_asyncio import AsyncIOMotorClient

logger = logging.getLogger("smart_workplace")

mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)


# -------- Location-scoped emit --------
# Super-admins join the SUPER_ROOM to see every event across all locations.
SUPER_ROOM = "_super_admin"


async def emit_scoped(event: str, payload: dict) -> None:
    """Emit a socket event to listeners in the payload's location only,
    plus all super_admins. If payload has no location_id, broadcasts globally.
    """
    loc_id = (payload or {}).get("location_id") if isinstance(payload, dict) else None
    if not loc_id:
        await sio.emit(event, payload)
        return
    # Per-location room
    await sio.emit(event, payload, room=loc_id)
    # And every super_admin who joined SUPER_ROOM
    await sio.emit(event, payload, room=SUPER_ROOM)
