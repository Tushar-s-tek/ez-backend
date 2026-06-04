"""Notification dispatcher: emits socket event, fires webhooks, persists failures."""
from __future__ import annotations

import uuid

from .db import db, sio, logger, emit_scoped
from .utils import now_utc, iso


_SETTINGS_FIELDS = (
    "slack_webhook_url", "teams_webhook_url",
    "whatsapp_token", "whatsapp_phone_id", "whatsapp_to",
    "email_enabled",
    "sound_new_request", "sound_new_order", "sound_accepted",
    "sound_started", "sound_ready", "sound_escalated", "sound_visitor",
    "nda_text", "nda_required", "visitor_badge_hours",
)


async def _settings_doc_id(location_id: str | None) -> str:
    return f"loc_{location_id}" if location_id else "global"


async def get_settings(location_id: str | None = None) -> dict:
    """Resolve effective settings with a per-location → global fallback.

    For any field that is missing or empty on the per-location doc, falls back
    to the global doc, then to defaults. This lets admins override only what
    they want to differ per location (e.g. a per-location Slack channel) while
    inheriting the rest.
    """
    g = await db.settings.find_one({"id": "global"}, {"_id": 0}) or {}
    if not location_id:
        return g
    loc = await db.settings.find_one({"id": f"loc_{location_id}"}, {"_id": 0}) or {}
    out = dict(g)
    for k in _SETTINGS_FIELDS:
        v = loc.get(k)
        if v not in (None, "", False) or k == "email_enabled":
            # email_enabled is a bool; keep an explicit False too
            if k == "email_enabled" and k in loc:
                out[k] = loc[k]
            elif v not in (None, "", False):
                out[k] = v
    return out


async def upsert_settings(patch: dict, location_id: str | None = None) -> dict:
    """Upsert into the per-location or global settings doc."""
    doc_id = await _settings_doc_id(location_id)
    set_on_insert = {"id": doc_id}
    if location_id:
        set_on_insert["location_id"] = location_id
    await db.settings.update_one(
        {"id": doc_id},
        {"$set": patch, "$setOnInsert": set_on_insert},
        upsert=True,
    )
    return await get_settings(location_id)


async def _record_failure(channel: str, event: str, error: str, payload_id: str | None) -> None:
    """Persist a failed webhook dispatch for admin visibility."""
    try:
        await db.failed_dispatches.insert_one({
            "id": str(uuid.uuid4()),
            "channel": channel,
            "event": event,
            "error": (error or "")[:500],
            "payload_id": payload_id,
            "resolved": False,
            "created_at": iso(now_utc()),
        })
    except Exception as e:
        logger.warning("could not persist failed_dispatch: %s", e)


async def _post_webhook(channel: str, event: str, url: str, json_body: dict, headers: dict | None, payload_id: str | None) -> None:
    """Best-effort HTTP POST. Failures are logged AND persisted to failed_dispatches."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5) as c:
            resp = await c.post(url, json=json_body, headers=headers or {})
            if resp.status_code >= 400:
                await _record_failure(channel, event, f"HTTP {resp.status_code}: {resp.text[:200]}", payload_id)
                logger.warning("%s webhook returned %s", channel, resp.status_code)
    except Exception as e:
        await _record_failure(channel, event, str(e), payload_id)
        logger.warning("%s webhook failed: %s", channel, e)


async def dispatch_notification(event: str, payload: dict) -> None:
    """Fan-out an event to all configured channels.

    Always emits an in-app socket event. Webhook failures are
    persisted to db.failed_dispatches for admin visibility.

    Settings are resolved per-location (with global fallback) so each office
    can have its own Slack channel / WhatsApp number, etc.
    """
    s = await get_settings(payload.get("location_id"))
    title = payload.get("category_name") or payload.get("name") or "Workplace event"
    room = payload.get("room_name") or payload.get("host_room_name") or ""
    msg = f"[{event}] {title} · {room}"
    payload_id = payload.get("id")
    logger.info("NOTIFY %s | %s", msg, payload_id)

    try:
        notification_body = {"event": event, "message": msg, "payload": payload, "location_id": payload.get("location_id")}
        await emit_scoped("notification", notification_body)
    except Exception as e:
        logger.warning("socket notify failed: %s", e)

    if s.get("slack_webhook_url"):
        await _post_webhook("slack", event, s["slack_webhook_url"], {"text": msg}, None, payload_id)

    if s.get("teams_webhook_url"):
        await _post_webhook("teams", event, s["teams_webhook_url"], {"text": msg}, None, payload_id)

    if s.get("whatsapp_token") and s.get("whatsapp_phone_id") and s.get("whatsapp_to"):
        url = f"https://graph.facebook.com/v18.0/{s['whatsapp_phone_id']}/messages"
        headers = {
            "Authorization": f"Bearer {s['whatsapp_token']}",
            "Content-Type": "application/json",
        }
        body = {
            "messaging_product": "whatsapp", "to": s["whatsapp_to"],
            "type": "text", "text": {"body": msg},
        }
        await _post_webhook("whatsapp", event, url, body, headers, payload_id)
