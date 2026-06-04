from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core import db, get_current_user, require_admin
from core.notify import get_settings, upsert_settings
from models import SettingsUpdate

router = APIRouter(prefix="/settings")


def _mask(v: str) -> str:
    if not v:
        return v
    if len(v) < 8:
        return "•" * len(v)
    return "•" * 8 + v[-4:]


def _resolve_location_id(user: dict, location_id: Optional[str]) -> Optional[str]:
    """Decide which location's settings doc to read/write.

    - super_admin: uses the `location_id` query param if given, else GLOBAL (None).
    - any other admin: forced to their own location.
    """
    if user["role"] == "super_admin":
        return location_id
    return user.get("location_id")


@router.get("")
async def get_settings_endpoint(
    location_id: Optional[str] = Query(None),
    user: dict = Depends(require_admin()),
):
    loc = _resolve_location_id(user, location_id)
    s = await get_settings(loc)
    out = dict(s)
    out["whatsapp_token"] = _mask(out.get("whatsapp_token", ""))
    out["slack_webhook_url"] = _mask(out.get("slack_webhook_url", ""))
    out["teams_webhook_url"] = _mask(out.get("teams_webhook_url", ""))
    out["__scope"] = "location" if loc else "global"
    out["__location_id"] = loc
    return out


@router.patch("")
async def update_settings(
    payload: SettingsUpdate,
    location_id: Optional[str] = Query(None),
    user: dict = Depends(require_admin()),
):
    loc = _resolve_location_id(user, location_id)
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    # Empty string is the user's way to CLEAR an override; keep it.
    if update:
        await upsert_settings(update, loc)
    # Return UNMASKED (so the admin can confirm what they just saved); GET masks.
    s = await get_settings(loc)
    out = dict(s)
    out["__scope"] = "location" if loc else "global"
    out["__location_id"] = loc
    return out


@router.delete("/override")
async def clear_location_override(
    location_id: str = Query(...),
    user: dict = Depends(require_admin()),
):
    """Wipe a location's per-location override so it falls back to global."""
    loc = _resolve_location_id(user, location_id)
    if not loc:
        raise HTTPException(status_code=400, detail="location_id required")
    await db.settings.delete_one({"id": f"loc_{loc}"})
    return {"ok": True}


# -------- Public sound mapping (no auth — kiosks need it) --------
_SOUND_FIELDS = (
    "sound_new_request", "sound_new_order", "sound_accepted",
    "sound_started", "sound_ready", "sound_escalated", "sound_visitor",
)


@router.get("/sounds")
async def get_sound_settings(location_id: Optional[str] = Query(None)):
    """Public endpoint — returns only the event → sound profile mapping
    so kiosks (unauthenticated tablets) and dashboards can both load it.
    Resolves per-location → global with the same fallback chain."""
    s = await get_settings(location_id)
    return {k: s.get(k) for k in _SOUND_FIELDS}


# -------- Failed notification dispatches (admin visibility) --------
@router.get("/failed-dispatches")
async def list_failed_dispatches(
    include_resolved: bool = False,
    limit: int = 100,
    _: dict = Depends(require_admin()),
):
    q = {} if include_resolved else {"resolved": False}
    return await db.failed_dispatches.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.patch("/failed-dispatches/{fid}/resolve")
async def resolve_failed_dispatch(fid: str, _: dict = Depends(require_admin())):
    res = await db.failed_dispatches.update_one({"id": fid}, {"$set": {"resolved": True}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return await db.failed_dispatches.find_one({"id": fid}, {"_id": 0})


@router.delete("/failed-dispatches")
async def clear_failed_dispatches(only_resolved: bool = True, _: dict = Depends(require_admin())):
    q = {"resolved": True} if only_resolved else {}
    res = await db.failed_dispatches.delete_many(q)
    return {"deleted": res.deleted_count}
