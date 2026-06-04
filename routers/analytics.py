from datetime import datetime, timedelta
from typing import Dict, Any, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from core import db, get_current_user, now_utc, iso, scope_filter, require_roles

router = APIRouter(prefix="/analytics")


@router.get("/compare")
async def analytics_compare(
    days: int = 7,
    _: dict = Depends(require_roles("super_admin")),
):
    """Side-by-side per-location KPIs for the last N days. Super-admin only.

    Returns one row per location plus an aggregated "All" row so the dashboard
    can render a comparison table.
    """
    since_iso = iso(now_utc() - timedelta(days=days))
    locations = await db.locations.find({}, {"_id": 0}).sort("name", 1).to_list(500)

    out_rows = []
    agg = {
        "id": "__all__", "name": "All locations", "total": 0, "delivered": 0,
        "pending": 0, "escalated": 0, "avg_response_seconds": 0.0,
        "avg_delivery_seconds": 0.0, "_resp_sum": 0.0, "_del_sum": 0.0,
        "_resp_n": 0, "_del_n": 0,
    }
    for loc in locations:
        q = {"location_id": loc["id"], "created_at": {"$gte": since_iso}}
        rows = await db.requests.find(q, {"_id": 0}).to_list(5000)
        delivered = sum(1 for r in rows if r.get("status") == "delivered")
        escalated = sum(1 for r in rows if r.get("escalated_at"))
        pending = sum(1 for r in rows if r.get("status") in ("requested", "accepted", "in_progress"))
        resp_t, del_t = [], []
        for r in rows:
            try:
                if r.get("accepted_at"):
                    resp_t.append((datetime.fromisoformat(r["accepted_at"]) - datetime.fromisoformat(r["created_at"])).total_seconds())
                if r.get("delivered_at"):
                    del_t.append((datetime.fromisoformat(r["delivered_at"]) - datetime.fromisoformat(r["created_at"])).total_seconds())
            except Exception:
                pass
        row = {
            "id": loc["id"], "name": loc["name"],
            "total": len(rows), "delivered": delivered, "pending": pending,
            "escalated": escalated,
            "avg_response_seconds": round(sum(resp_t) / len(resp_t), 1) if resp_t else 0,
            "avg_delivery_seconds": round(sum(del_t) / len(del_t), 1) if del_t else 0,
            "delivered_pct": round(100 * delivered / len(rows), 1) if rows else 0,
        }
        out_rows.append(row)

        agg["total"] += len(rows)
        agg["delivered"] += delivered
        agg["pending"] += pending
        agg["escalated"] += escalated
        agg["_resp_sum"] += sum(resp_t)
        agg["_resp_n"] += len(resp_t)
        agg["_del_sum"] += sum(del_t)
        agg["_del_n"] += len(del_t)

    agg["avg_response_seconds"] = round(agg["_resp_sum"] / agg["_resp_n"], 1) if agg["_resp_n"] else 0
    agg["avg_delivery_seconds"] = round(agg["_del_sum"] / agg["_del_n"], 1) if agg["_del_n"] else 0
    agg["delivered_pct"] = round(100 * agg["delivered"] / agg["total"], 1) if agg["total"] else 0
    for k in ("_resp_sum", "_del_sum", "_resp_n", "_del_n"):
        agg.pop(k, None)

    return {"days": days, "locations": out_rows, "aggregate": agg}


@router.get("/overview")
async def analytics_overview(
    days: int = 7,
    location_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    since_iso = iso(now_utc() - timedelta(days=days))
    q: Dict[str, Any] = dict(scope_filter(user, location_id))
    q["created_at"] = {"$gte": since_iso}
    if user["role"] not in ("super_admin", "admin"):
        dept = user.get("department_id")
        if dept:
            q["$or"] = [
                {"department_id": dept},
                {"department_ids": dept},
            ]
        else:
            q["department_id"] = "__no_dept__"
    all_reqs = await db.requests.find(q, {"_id": 0}).to_list(5000)

    by_status: Dict[str, int] = {}
    by_category: Dict[str, int] = {}
    by_room: Dict[str, int] = {}
    by_hour = [0] * 24
    by_day: Dict[str, int] = {}
    response_times = []
    delivery_times = []

    for r in all_reqs:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        by_category[r.get("category_name", "Unknown")] = by_category.get(r.get("category_name", "Unknown"), 0) + 1
        by_room[r.get("room_name", "Unknown")] = by_room.get(r.get("room_name", "Unknown"), 0) + 1
        try:
            created = datetime.fromisoformat(r["created_at"])
            by_hour[created.hour] += 1
            dkey = created.strftime("%Y-%m-%d")
            by_day[dkey] = by_day.get(dkey, 0) + 1
            if r.get("accepted_at"):
                response_times.append((datetime.fromisoformat(r["accepted_at"]) - created).total_seconds())
            if r.get("delivered_at"):
                delivery_times.append((datetime.fromisoformat(r["delivered_at"]) - created).total_seconds())
        except Exception:
            pass

    avg_response = sum(response_times) / len(response_times) if response_times else 0
    avg_delivery = sum(delivery_times) / len(delivery_times) if delivery_times else 0

    return {
        "total": len(all_reqs),
        "by_status": by_status,
        "top_categories": sorted(by_category.items(), key=lambda x: -x[1])[:10],
        "top_rooms": sorted(by_room.items(), key=lambda x: -x[1])[:10],
        "by_hour": [{"hour": h, "count": c} for h, c in enumerate(by_hour)],
        "by_day": [{"day": d, "count": c} for d, c in sorted(by_day.items())],
        "avg_response_seconds": round(avg_response, 1),
        "avg_delivery_seconds": round(avg_delivery, 1),
        "pending": by_status.get("requested", 0) + by_status.get("accepted", 0) + by_status.get("in_progress", 0),
    }


@router.get("/export.csv")
async def analytics_export(
    days: int = 30,
    location_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    import csv
    import io as stdio
    since_iso = iso(now_utc() - timedelta(days=days))
    q: Dict[str, Any] = dict(scope_filter(user, location_id))
    q["created_at"] = {"$gte": since_iso}
    rows = await db.requests.find(q, {"_id": 0}).to_list(10000)
    headers = ["id", "room_name", "category_name", "priority", "status", "created_at",
               "accepted_at", "delivered_at", "closed_at", "escalated_at", "assignee_name", "note"]
    buf = stdio.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    for r in rows:
        w.writerow([r.get(h, "") if r.get(h, "") is not None else "" for h in headers])
    return PlainTextResponse(
        buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=requests.csv"},
    )
