"""Categories + Departments + Routing rules."""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

from core import db, get_current_user, require_admin, now_utc, iso, scope_filter, resolve_target_location
from models import CategoryCreate, CategoryUpdate, DepartmentCreate, RoutingRuleCreate

router = APIRouter()


# -------- Departments --------
@router.get("/departments")
async def list_departments(location_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = scope_filter(user, location_id)
    return await db.departments.find(q, {"_id": 0}).to_list(500)


@router.post("/departments")
async def create_department(payload: DepartmentCreate, user: dict = Depends(require_admin())):
    loc = resolve_target_location(user, payload.location_id)
    doc = {
        "id": str(uuid.uuid4()), "name": payload.name,
        "description": payload.description, "location_id": loc,
        "created_at": iso(now_utc()),
    }
    await db.departments.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/departments/{dept_id}")
async def update_department(dept_id: str, payload: DepartmentCreate, user: dict = Depends(require_admin())):
    existing = await db.departments.find_one({"id": dept_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if user["role"] != "super_admin" and existing.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location update not allowed")
    await db.departments.update_one(
        {"id": dept_id},
        {"$set": {"name": payload.name, "description": payload.description}},
    )
    return await db.departments.find_one({"id": dept_id}, {"_id": 0})


@router.delete("/departments/{dept_id}")
async def delete_department(dept_id: str, user: dict = Depends(require_admin())):
    existing = await db.departments.find_one({"id": dept_id})
    if existing and user["role"] != "super_admin" and existing.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location delete not allowed")
    await db.departments.delete_one({"id": dept_id})
    return {"ok": True}


# -------- Categories --------
@router.get("/categories")
async def list_categories(
    active_only: bool = False,
    location_id: Optional[str] = None,
    user: Optional[dict] = None,
):
    # Public endpoint: kiosk uses ?location_id= to fetch its room's categories
    q = {}
    if active_only:
        q["active"] = True
    if location_id:
        q["location_id"] = location_id
    return await db.categories.find(q, {"_id": 0}).to_list(1000)


@router.post("/categories")
async def create_category(payload: CategoryCreate, user: dict = Depends(require_admin())):
    loc = resolve_target_location(user, payload.location_id)
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["location_id"] = loc
    doc["created_at"] = iso(now_utc())
    await db.categories.insert_one(doc)
    doc.pop("_id", None)
    # Auto-create a default routing rule so the new category appears on
    # /admin/routing immediately, routed to whichever department was set as
    # the category's owner (admins can change it from the routing UI).
    dept_id = doc.get("department_id")
    await db.routing_rules.insert_one({
        "id": str(uuid.uuid4()),
        "category_id": doc["id"],
        "department_id": dept_id,
        "department_ids": [dept_id] if dept_id else [],
        "location_id": loc,
        "escalation_minutes": 15,
        "created_at": iso(now_utc()),
    })
    return doc


@router.patch("/categories/{cat_id}")
async def update_category(cat_id: str, payload: CategoryUpdate, user: dict = Depends(require_admin())):
    existing = await db.categories.find_one({"id": cat_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if user["role"] != "super_admin" and existing.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location update not allowed")
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if update:
        await db.categories.update_one({"id": cat_id}, {"$set": update})
    return await db.categories.find_one({"id": cat_id}, {"_id": 0})


@router.delete("/categories/{cat_id}")
async def delete_category(cat_id: str, user: dict = Depends(require_admin())):
    existing = await db.categories.find_one({"id": cat_id})
    if existing and user["role"] != "super_admin" and existing.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location delete not allowed")
    await db.categories.delete_one({"id": cat_id})
    return {"ok": True}


# -------- Routing rules --------
@router.get("/routing-rules")
async def list_routing_rules(location_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = scope_filter(user, location_id)
    return await db.routing_rules.find(q, {"_id": 0}).to_list(1000)


@router.post("/routing-rules")
async def upsert_routing_rule(payload: RoutingRuleCreate, user: dict = Depends(require_admin())):
    # location_id inherited from the category
    cat = await db.categories.find_one({"id": payload.category_id})
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if user["role"] != "super_admin" and cat.get("location_id") != user.get("location_id"):
        raise HTTPException(status_code=403, detail="Cross-location routing rule not allowed")
    loc = cat.get("location_id")

    # Normalise input into a deduped, ordered list of department ids.
    raw_ids = list(payload.department_ids or [])
    if payload.department_id and payload.department_id not in raw_ids:
        raw_ids.insert(0, payload.department_id)
    dept_ids: list[str] = []
    for did in raw_ids:
        if did and did not in dept_ids:
            dept_ids.append(did)
    if not dept_ids:
        raise HTTPException(status_code=400, detail="At least one department is required")

    update_doc = {
        "department_id": dept_ids[0],          # primary, kept for backward compat
        "department_ids": dept_ids,            # full multi-dept routing list
        "escalation_minutes": payload.escalation_minutes,
        "location_id": loc,
    }
    existing = await db.routing_rules.find_one({"category_id": payload.category_id})
    if existing:
        await db.routing_rules.update_one(
            {"category_id": payload.category_id},
            {"$set": update_doc},
        )
    else:
        doc = {
            "id": str(uuid.uuid4()),
            "category_id": payload.category_id,
            **update_doc,
        }
        await db.routing_rules.insert_one(doc)
    return await db.routing_rules.find_one({"category_id": payload.category_id}, {"_id": 0})


@router.delete("/routing-rules/{rule_id}")
async def delete_routing_rule(rule_id: str, _: dict = Depends(require_admin())):
    await db.routing_rules.delete_one({"id": rule_id})
    return {"ok": True}
