"""Database seed + background escalation worker."""
import os
import uuid
import asyncio
from datetime import datetime
from pathlib import Path

from core import (
    db, sio, emit_scoped, hash_password, verify_password, gen_pin, gen_qr_data_url,
    now_utc, iso, dispatch_notification, logger,
)


async def create_indexes() -> None:
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.users.create_index("location_id")
    await db.rooms.create_index("id", unique=True)
    await db.rooms.create_index("pin")
    await db.rooms.create_index("location_id")
    await db.categories.create_index("id", unique=True)
    await db.categories.create_index("location_id")
    await db.departments.create_index("id", unique=True)
    await db.departments.create_index("location_id")
    await db.requests.create_index("id", unique=True)
    await db.requests.create_index("created_at")
    await db.requests.create_index("location_id")
    await db.visitors.create_index("id", unique=True)
    await db.visitors.create_index("location_id")
    await db.preorders.create_index("id", unique=True)
    await db.preorders.create_index("location_id")
    await db.menu_items.create_index("id", unique=True)
    await db.menu_items.create_index("location_id")
    await db.iot_commands.create_index("created_at")
    await db.iot_commands.create_index("location_id")
    await db.failed_dispatches.create_index("id", unique=True)
    await db.failed_dispatches.create_index("created_at")
    await db.failed_dispatches.create_index("resolved")
    await db.locations.create_index("id", unique=True)
    await db.routing_rules.create_index("location_id")


DEFAULT_DEPTS = [
    ("Cafeteria", "cafeteria", "Food & beverages team"),
    ("Admin", "admin_dept", "Office supplies & general admin"),
    ("Facilities", "facilities", "AC, lights, cleaning"),
    ("IT Support", "it_support", "IT & technical support"),
    ("Reception", "reception", "Front desk & visitors"),
    ("Security", "security", "Building security"),
]

DEFAULT_CATEGORIES = [
    # (name, icon, dept_key, color, priority, group)
    ("Coffee", "Coffee", "cafeteria", "#7C5A3D", "normal", "Hospitality"),
    ("Tea", "TeaBag", "cafeteria", "#3D7C4F", "normal", "Hospitality"),
    ("Water", "Drop", "cafeteria", "#2196F3", "normal", "Hospitality"),
    ("Snacks", "Cookie", "cafeteria", "#D97706", "normal", "Hospitality"),
    ("Lunch", "ForkKnife", "cafeteria", "#B45309", "normal", "Hospitality"),
    ("Coke", "BeerBottle", "cafeteria", "#DC2626", "normal", "Hospitality"),
    ("Marker", "PenNib", "admin_dept", "#0055FF", "low", "Office Supplies"),
    ("Pen", "Pen", "admin_dept", "#1E40AF", "low", "Office Supplies"),
    ("Notebook", "Notebook", "admin_dept", "#7C3AED", "low", "Office Supplies"),
    ("Whiteboard Cleaner", "Eraser", "admin_dept", "#0EA5E9", "low", "Office Supplies"),
    ("Sticky Notes", "StickyNote", "admin_dept", "#F59E0B", "low", "Office Supplies"),
    ("AC On/Off", "ThermometerSimple", "facilities", "#0891B2", "normal", "Facilities"),
    ("Too Cold", "Snowflake", "facilities", "#0EA5E9", "normal", "Facilities"),
    ("Too Hot", "Sun", "facilities", "#EA580C", "normal", "Facilities"),
    ("Cleaning Required", "Broom", "facilities", "#16A34A", "normal", "Facilities"),
    ("Light Issue", "Lightbulb", "facilities", "#FBBF24", "normal", "Facilities"),
    ("Projector Issue", "ProjectorScreen", "it_support", "#7C3AED", "high", "IT Support"),
    ("HDMI Not Working", "Plugs", "it_support", "#6D28D9", "high", "IT Support"),
    ("Internet Issue", "WifiSlash", "it_support", "#DC2626", "high", "IT Support"),
    ("Laptop Support", "Laptop", "it_support", "#1E40AF", "high", "IT Support"),
    ("Visitor Waiting", "UserPlus", "reception", "#0EA5E9", "normal", "Security/Admin"),
    ("Courier Pickup", "Package", "reception", "#F59E0B", "normal", "Security/Admin"),
    ("Access Support", "Key", "security", "#475569", "high", "Security/Admin"),
    ("Immediate Assistance", "Siren", "security", "#DC2626", "urgent", "Emergency"),
]

SAMPLE_ROOMS = [
    ("CEO Cabin", "5", "HQ Wing A"),
    ("Board Room 01", "4", "HQ Wing A"),
    ("Interview Room 2", "2", "HQ Wing B"),
    ("Training Hall", "1", "HQ Wing C"),
    ("HR Discussion Room", "3", "HQ Wing B"),
]

DEFAULT_MENU = [
    ("Veg Sandwich", "Lunch", 120, "Fresh grilled veggie sandwich", "Sandwich", "#7C3AED"),
    ("Chicken Wrap", "Lunch", 180, "Spicy chicken wrap with greens", "Hamburger", "#B45309"),
    ("Filter Coffee", "Beverages", 60, "South-Indian filter coffee", "Coffee", "#7C5A3D"),
    ("Cappuccino", "Beverages", 90, "Italian-style cappuccino", "Coffee", "#3D2B1F"),
    ("Masala Chai", "Beverages", 40, "Indian-style spiced tea", "TeaBag", "#3D7C4F"),
    ("Fresh Juice", "Beverages", 110, "Seasonal fresh fruit juice", "Drop", "#F59E0B"),
    ("Cookies", "Snacks", 50, "Pack of 3 cookies", "Cookie", "#D97706"),
    ("Fruit Bowl", "Snacks", 140, "Cut seasonal fruits", "Apple", "#10B981"),
]

DEMO_STAFF = [
    ("reception@workplace.com", "Reception Staff", "reception", "reception"),
    ("cafeteria@workplace.com", "Cafeteria Staff", "cafeteria", "cafeteria"),
    ("it@workplace.com", "IT Support", "it_support", "it_support"),
    ("facilities@workplace.com", "Facilities", "facilities", "facilities"),
    ("security@workplace.com", "Security", "security", "security"),
]


async def seed_location_defaults(location_id: str) -> dict:
    """Idempotently seed default catalog (departments, categories with routing,
    menu items) for a given location. Returns a summary dict.

    Called on:
      - Initial seed (for the default location)
      - POST /api/locations (for every new location created)
    Existing entries are NOT touched, so admins can safely customise after
    creation.
    """
    summary = {"departments": 0, "categories": 0, "menu_items": 0, "routing_rules": 0}

    # Departments
    dept_ids: dict[str, str] = {}
    for name, key, desc in DEFAULT_DEPTS:
        existing = await db.departments.find_one({"name": name, "location_id": location_id})
        if existing:
            dept_ids[key] = existing["id"]
            continue
        d = {
            "id": str(uuid.uuid4()), "name": name, "description": desc,
            "location_id": location_id, "created_at": iso(now_utc()),
        }
        await db.departments.insert_one(d)
        dept_ids[key] = d["id"]
        summary["departments"] += 1

    # Categories + routing
    for name, icon, dept_key, color, priority, group in DEFAULT_CATEGORIES:
        if await db.categories.find_one({"name": name, "location_id": location_id}):
            continue
        cat_id = str(uuid.uuid4())
        await db.categories.insert_one({
            "id": cat_id, "name": name, "icon": icon,
            "department_id": dept_ids.get(dept_key), "color": color,
            "priority": priority, "group": group, "active": True,
            "location_id": location_id, "created_at": iso(now_utc()),
        })
        summary["categories"] += 1
        await db.routing_rules.insert_one({
            "id": str(uuid.uuid4()), "category_id": cat_id,
            "department_id": dept_ids.get(dept_key),
            "department_ids": [dept_ids.get(dept_key)] if dept_ids.get(dept_key) else [],
            "location_id": location_id,
            "escalation_minutes": 5 if priority == "urgent" else (10 if priority == "high" else 15),
        })
        summary["routing_rules"] += 1

    # Menu
    for name, cat, price, desc, icon, color in DEFAULT_MENU:
        if await db.menu_items.find_one({"name": name, "location_id": location_id}):
            continue
        await db.menu_items.insert_one({
            "id": str(uuid.uuid4()), "name": name, "category": cat,
            "price": float(price), "description": desc, "icon": icon,
            "color": color, "available": True,
            "location_id": location_id, "created_at": iso(now_utc()),
        })
        summary["menu_items"] += 1

    return summary


async def seed() -> None:
    await create_indexes()

    # ---- Default location (idempotent via is_default flag, not by name) ----
    # If user renames the default location, we must NOT re-seed a new one.
    default_loc = await db.locations.find_one({"is_default": True})
    if not default_loc:
        # Migrate: any pre-existing location named "HQ — Default" becomes the default.
        legacy = await db.locations.find_one({"name": "HQ — Default"})
        if legacy:
            await db.locations.update_one({"id": legacy["id"]}, {"$set": {"is_default": True}})
            default_loc = await db.locations.find_one({"id": legacy["id"]})
    if not default_loc:
        default_loc = {
            "id": str(uuid.uuid4()),
            "name": "HQ — Default",
            "code": "HQ",
            "address": "Main Office",
            "timezone": "UTC",
            "is_default": True,
            "active": True,
            "created_at": iso(now_utc()),
        }
        await db.locations.insert_one(default_loc)
    default_loc_id = default_loc["id"]

    # ---- Backfill existing rows missing location_id ----
    for coll in ("rooms", "categories", "departments", "users", "menu_items", "routing_rules", "requests", "visitors", "preorders", "iot_commands"):
        await db[coll].update_many(
            {"$or": [{"location_id": {"$exists": False}}, {"location_id": None}]},
            {"$set": {"location_id": default_loc_id}},
        )
    # Super admin must NOT have a location
    await db.users.update_many({"role": "super_admin"}, {"$set": {"location_id": None}})

    # ---- Backfill multi-dept routing fields (`department_ids`) ----
    # routing_rules: promote single department_id into list when missing
    async for rule in db.routing_rules.find({"department_ids": {"$exists": False}}, {"_id": 0}):
        did = rule.get("department_id")
        await db.routing_rules.update_one(
            {"id": rule["id"]},
            {"$set": {"department_ids": [did] if did else []}},
        )
    # requests: same — so historical rows continue to be visible to their dept
    async for req in db.requests.find(
        {"department_ids": {"$exists": False}, "department_id": {"$ne": None}},
        {"_id": 0, "id": 1, "department_id": 1},
    ):
        await db.requests.update_one(
            {"id": req["id"]},
            {"$set": {"department_ids": [req["department_id"]]}},
        )
    # ---- Backfill department_id on pre-orders so cafeteria-only filtering
    # works for historical rows created before iteration 14. We map each
    # preorder's location_id → that location's Cafeteria department.
    cafe_by_loc: dict = {}
    async for d in db.departments.find(
        {"name": {"$regex": "cafeter", "$options": "i"}}, {"_id": 0, "id": 1, "location_id": 1},
    ):
        cafe_by_loc[d.get("location_id")] = d["id"]
    async for po in db.preorders.find(
        {"$or": [{"department_id": {"$exists": False}}, {"department_id": None}]},
        {"_id": 0, "id": 1, "location_id": 1},
    ):
        cafe_id = cafe_by_loc.get(po.get("location_id"))
        if cafe_id:
            await db.preorders.update_one(
                {"id": po["id"]},
                {"$set": {"department_id": cafe_id, "department_ids": [cafe_id]}},
            )

    # ---- Backfill routing_rules for every existing category that doesn't
    # have one yet. Iteration 15 added auto-create on POST /categories, but
    # categories created before that won't have an explicit rule, so they
    # rely on a fallback path. Make every category appear in /admin/routing
    # with a real, editable rule by inserting one with sensible defaults.
    rule_cat_ids = set()
    async for r in db.routing_rules.find({}, {"_id": 0, "category_id": 1}):
        if r.get("category_id"):
            rule_cat_ids.add(r["category_id"])
    inserted = 0
    async for c in db.categories.find({}, {"_id": 0}):
        if c["id"] in rule_cat_ids:
            continue
        dept_id = c.get("department_id")
        await db.routing_rules.insert_one({
            "id": str(uuid.uuid4()),
            "category_id": c["id"],
            "department_id": dept_id,
            "department_ids": [dept_id] if dept_id else [],
            "location_id": c.get("location_id"),
            "escalation_minutes": 15,
            "created_at": iso(now_utc()),
        })
        inserted += 1
    if inserted:
        print(f"  Backfilled {inserted} routing rules for existing categories")

    # ---- Backfill short_code on every room (URL shortener — iteration 20).
    # Skip rooms that already have one; assign a unique 4-char code to the
    # rest. Rebuild qr_payload + qr_image to point at /r/<code> so newly
    # printed signs use the tiny URL.
    import random
    SHORT_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"
    used = set()
    async for r in db.rooms.find({"short_code": {"$exists": True, "$ne": None}}, {"_id": 0, "short_code": 1}):
        if r.get("short_code"):
            used.add(r["short_code"])

    def _gen_code():
        for _ in range(100):
            c = "".join(random.choices(SHORT_ALPHABET, k=4))
            if c not in used:
                used.add(c)
                return c
        return None

    frontend = os.environ.get("FRONTEND_URL", "").rstrip("/")
    upgraded = 0
    async for r in db.rooms.find(
        {"$or": [{"short_code": {"$exists": False}}, {"short_code": None}]},
        {"_id": 0, "id": 1, "pin": 1},
    ):
        code = _gen_code()
        if not code or not r.get("pin"):
            continue
        qr_payload = f"{frontend}/r/{code}" if frontend else f"/r/{code}"
        await db.rooms.update_one(
            {"id": r["id"]},
            {"$set": {
                "short_code": code,
                "qr_payload": qr_payload,
                "qr_image": gen_qr_data_url(qr_payload),
            }},
        )
        upgraded += 1
    if upgraded:
        print(f"  Backfilled {upgraded} room short URLs")

    # Seed default catalog for the default location (idempotent)
    await seed_location_defaults(default_loc_id)
    # Build a lookup of dept ids in the default location for admin/staff seeding
    dept_ids: dict[str, str] = {}
    for name, key, _ in DEFAULT_DEPTS:
        d = await db.departments.find_one({"name": name, "location_id": default_loc_id}, {"_id": 0, "id": 1})
        if d:
            dept_ids[key] = d["id"]

    # Admin user
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_password = os.environ["ADMIN_PASSWORD"]
    existing_admin = await db.users.find_one({"email": admin_email})
    if not existing_admin:
        await db.users.insert_one({
            "id": str(uuid.uuid4()), "email": admin_email, "name": "Super Admin",
            "role": "super_admin", "department_id": None, "location_id": None,
            "password_hash": hash_password(admin_password), "created_at": iso(now_utc()),
        })
    elif not verify_password(admin_password, existing_admin["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

    # Demo staff
    for email, name, role, dept_key in DEMO_STAFF:
        if not await db.users.find_one({"email": email}):
            await db.users.insert_one({
                "id": str(uuid.uuid4()), "email": email, "name": name,
                "role": role, "department_id": dept_ids.get(dept_key),
                "location_id": default_loc_id,
                "password_hash": hash_password("demo123"), "created_at": iso(now_utc()),
            })

    # Categories, routing, and menu items for the default location were already
    # seeded by seed_location_defaults() above. Only rooms below are
    # location-specific demo data we keep just for the bootstrap location.

    # Rooms
    frontend_url = os.environ.get("FRONTEND_URL", "").rstrip("/")
    def qr_for(pin: str) -> str:
        return f"{frontend_url}/room/{pin}" if frontend_url else f"/room/{pin}"

    for name, floor, location in SAMPLE_ROOMS:
        if not await db.rooms.find_one({"name": name, "location_id": default_loc_id}):
            room_id = str(uuid.uuid4())
            pin = "123456" if name == "CEO Cabin" else gen_pin()
            qr_payload = qr_for(pin)
            await db.rooms.insert_one({
                "id": room_id, "name": name, "floor": floor, "location": location,
                "department_id": None, "location_id": default_loc_id,
                "pin": pin, "qr_payload": qr_payload,
                "qr_image": gen_qr_data_url(qr_payload), "created_at": iso(now_utc()),
            })

    # Settings
    if not await db.settings.find_one({"id": "global"}):
        await db.settings.insert_one({
            "id": "global", "slack_webhook_url": "", "teams_webhook_url": "",
            "whatsapp_token": "", "whatsapp_phone_id": "", "whatsapp_to": "",
            "email_enabled": False,
        })

    # Test credentials file
    creds_path = Path("/app/memory/test_credentials.md")
    creds_path.parent.mkdir(parents=True, exist_ok=True)
    creds_path.write_text(
        "# Smart Workplace - Test Credentials\n\n"
        f"## Super Admin\n- email: {admin_email}\n- password: {admin_password}\n- role: super_admin\n\n"
        "## Staff Demo Accounts (password: demo123)\n"
        "- reception@workplace.com / reception\n"
        "- cafeteria@workplace.com / cafeteria\n"
        "- it@workplace.com / it_support\n"
        "- facilities@workplace.com / facilities\n"
        "- security@workplace.com / security\n\n"
        "## Demo Room PIN\n- Room: CEO Cabin, PIN: 123456\n\n"
        "## Auth Endpoints\n- POST /api/auth/login {email,password}\n- POST /api/auth/logout\n- GET /api/auth/me\n"
        "## Room Access\n- POST /api/rooms/access {pin}\n"
    )


# ---------------- Background escalation worker ---------------- #
ESCALATION_INTERVAL_SEC = 30


async def escalation_worker() -> None:
    """Auto-flip requests to 'escalated' when they exceed their escalation_minutes window.

    Runs forever in background. Scans active requests every ESCALATION_INTERVAL_SEC.
    """
    logger.info("escalation_worker started (interval=%ss)", ESCALATION_INTERVAL_SEC)
    while True:
        try:
            cursor = db.requests.find(
                {"status": {"$in": ["requested", "accepted", "in_progress"]}},
                {"_id": 0},
            )
            async for req in cursor:
                try:
                    created = datetime.fromisoformat(req["created_at"])
                except Exception:
                    continue
                esc_min = req.get("escalation_minutes") or 15
                age_sec = (now_utc() - created).total_seconds()
                if age_sec <= esc_min * 60:
                    continue
                ts = iso(now_utc())
                await db.requests.update_one(
                    {"id": req["id"]},
                    {
                        "$set": {"status": "escalated", "updated_at": ts, "escalated_at": ts},
                        "$push": {"history": {
                            "status": "escalated", "at": ts,
                            "by": "system", "note": f"auto-escalated after {esc_min}m",
                        }},
                    },
                )
                updated = await db.requests.find_one({"id": req["id"]}, {"_id": 0})
                await emit_scoped("request:update", updated)
                await dispatch_notification("auto_escalated", updated)
                logger.info("auto-escalated request %s (age=%ds, limit=%dm)", req["id"], int(age_sec), esc_min)
        except Exception as e:
            logger.warning("escalation_worker iteration failed: %s", e)
        await asyncio.sleep(ESCALATION_INTERVAL_SEC)
