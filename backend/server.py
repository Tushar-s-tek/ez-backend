"""Smart Workplace API entry point.

Loads environment, builds FastAPI app, mounts routers under /api,
wraps with Socket.IO, runs seed + escalation worker on startup.
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import asyncio
import logging

import socketio
from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

from core import sio, mongo_client, SUPER_ROOM
from seed import seed, escalation_worker
from routers import (
    auth as auth_router,
    rooms as rooms_router,
    catalog as catalog_router,
    requests as requests_router,
    users as users_router,
    analytics as analytics_router,
    visitors as visitors_router,
    cafeteria as cafeteria_router,
    iot as iot_router,
    settings as settings_router,
    locations as locations_router,
    roles as roles_router,
)


# -------- FastAPI app --------
fastapi_app = FastAPI(title="Smart Workplace API")

api_router = APIRouter(prefix="/api")
api_router.include_router(auth_router.router)
api_router.include_router(locations_router.router)
api_router.include_router(rooms_router.router)
api_router.include_router(catalog_router.router)
api_router.include_router(requests_router.router)
api_router.include_router(users_router.router)
api_router.include_router(analytics_router.router)
api_router.include_router(visitors_router.router)
api_router.include_router(cafeteria_router.router)
api_router.include_router(iot_router.router)
api_router.include_router(settings_router.router)
api_router.include_router(roles_router.router)


@api_router.get("/")
async def root():
    return {"service": "Smart Workplace API", "status": "ok"}


fastapi_app.include_router(api_router)


# -------- CORS --------
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origin_regex=r"https?://([a-z0-9-]+\.)*(emergentagent\.com|localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------- Socket.IO events --------
@sio.event
async def connect(sid, environ):
    pass


@sio.event
async def disconnect(sid):
    pass


@sio.event
async def join_location(sid, data):
    """Frontend calls this on connect (and again when active location changes).

    payload: { location_id: str | None, super: bool }
      - location_id : the location whose events the client wants to receive.
      - super       : when True, ALSO subscribes to the SUPER_ROOM so the client
                      gets every event across all locations (admin overview).
    """
    if not isinstance(data, dict):
        return
    # Leave every previous room (except the default SID room) so a switch is clean.
    for r in list(sio.rooms(sid)):
        if r != sid:
            await sio.leave_room(sid, r)
    loc = data.get("location_id")
    if loc:
        await sio.enter_room(sid, loc)
    if data.get("super"):
        await sio.enter_room(sid, SUPER_ROOM)


# -------- Startup / shutdown --------
_background_tasks: set[asyncio.Task] = set()


@fastapi_app.on_event("startup")
async def on_startup():
    await seed()
    task = asyncio.create_task(escalation_worker())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


@fastapi_app.on_event("shutdown")
async def on_shutdown():
    for t in list(_background_tasks):
        t.cancel()
    mongo_client.close()


# -------- Logging --------
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")


# -------- ASGI app (Socket.IO wraps FastAPI) --------
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app, socketio_path="/api/socket.io")
