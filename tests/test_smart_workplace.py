"""Smart Workplace Assistance Platform - end-to-end backend tests.
Covers: auth, departments, categories, rooms (incl. PIN access), routing rules,
requests pipeline, users CRUD, analytics, CSV export, Socket.IO handshake.
"""
import os
import io
import csv
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to frontend/.env if not in env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

API = f"{BASE_URL}/api"
ADMIN = {"email": "admin@workplace.com", "password": "admin123"}
RECEPTION = {"email": "reception@workplace.com", "password": "demo123"}
CAFETERIA = {"email": "cafeteria@workplace.com", "password": "demo123"}

state = {}


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and "user" in data
    assert data["user"]["email"] == ADMIN["email"]
    assert data["user"]["role"] == "super_admin"
    return data["token"]


@pytest.fixture(scope="module")
def reception_token():
    r = requests.post(f"{API}/auth/login", json=RECEPTION, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def cafeteria_token():
    r = requests.post(f"{API}/auth/login", json=CAFETERIA, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def default_location_id(admin_token):
    r = requests.get(f"{API}/locations", headers=auth_headers(admin_token), timeout=10)
    assert r.status_code == 200
    locs = r.json()
    assert locs, "No locations seeded"
    # Default seeded location is "HQ — Default"
    default = next((l for l in locs if l.get("is_default")), locs[0])
    return default["id"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Auth ----------
class TestAuth:
    def test_login_invalid(self):
        r = requests.post(f"{API}/auth/login", json={"email": "bad@x.com", "password": "x"}, timeout=10)
        assert r.status_code == 401

    def test_me_requires_auth(self):
        assert requests.get(f"{API}/auth/me", timeout=10).status_code == 401

    def test_me_with_bearer(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=auth_headers(admin_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN["email"]

    def test_login_cookie_set(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json=ADMIN, timeout=10)
        assert r.status_code == 200
        assert "access_token" in s.cookies
        r2 = s.get(f"{API}/auth/me", timeout=10)
        assert r2.status_code == 200


# ---------- Departments ----------
class TestDepartments:
    def test_list_default_six(self, admin_token):
        r = requests.get(f"{API}/departments", headers=auth_headers(admin_token), timeout=10)
        assert r.status_code == 200
        names = {d["name"] for d in r.json()}
        for required in ["Cafeteria", "Admin", "Facilities", "IT Support", "Reception", "Security"]:
            assert required in names, f"missing {required}"
        state["dept_by_name"] = {d["name"]: d["id"] for d in r.json()}


# ---------- Categories ----------
class TestCategories:
    def test_list_seeded(self, admin_token):
        r = requests.get(f"{API}/categories", headers=auth_headers(admin_token), timeout=10)
        assert r.status_code == 200
        cats = r.json()
        assert len(cats) >= 10
        sample = cats[0]
        for f in ("id", "name", "icon", "color", "priority", "group", "active"):
            assert f in sample
        state["categories"] = cats
        coffee = next((c for c in cats if c["name"] == "Coffee"), None)
        assert coffee is not None
        state["coffee_cat"] = coffee

    def test_create_requires_admin(self, reception_token):
        r = requests.post(
            f"{API}/categories",
            headers=auth_headers(reception_token),
            json={"name": "TEST_BadCat", "icon": "X", "department_id": "x", "color": "#000"},
            timeout=10,
        )
        assert r.status_code == 403

    def test_create_as_admin(self, admin_token, default_location_id):
        dept_id = state["dept_by_name"]["Cafeteria"]
        payload = {
            "name": f"TEST_Cat_{uuid.uuid4().hex[:6]}",
            "icon": "Coffee", "department_id": dept_id,
            "color": "#123456", "priority": "high", "group": "Hospitality", "active": True,
            "location_id": default_location_id,
        }
        r = requests.post(f"{API}/categories", headers=auth_headers(admin_token), json=payload, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == payload["name"]
        assert body["color"] == "#123456"
        state["test_cat_id"] = body["id"]


# ---------- Rooms ----------
class TestRooms:
    def test_list_rooms(self, admin_token):
        r = requests.get(f"{API}/rooms", headers=auth_headers(admin_token), timeout=10)
        assert r.status_code == 200
        rooms = r.json()
        assert len(rooms) >= 1
        for room in rooms:
            assert "pin" in room
            assert "qr_image" in room and room["qr_image"].startswith("data:image/png;base64,")
        ceo = next((r for r in rooms if r["name"] == "CEO Cabin"), None)
        assert ceo is not None and ceo["pin"] == "123456"
        state["ceo_room"] = ceo

    def test_room_access_by_pin_public(self):
        r = requests.post(f"{API}/rooms/access", json={"pin": "123456"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["name"] == "CEO Cabin"

    def test_room_access_invalid_pin(self):
        r = requests.post(f"{API}/rooms/access", json={"pin": "000000"}, timeout=10)
        assert r.status_code == 404

    def test_create_room_admin(self, admin_token, default_location_id):
        r = requests.post(
            f"{API}/rooms",
            headers=auth_headers(admin_token),
            json={"name": f"TEST_Room_{uuid.uuid4().hex[:6]}", "floor": "9", "location": "Test",
                  "location_id": default_location_id},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["pin"] and len(body["pin"]) == 6
        assert body["qr_image"].startswith("data:image/png;")
        state["test_room"] = body

    def test_regenerate_pin(self, admin_token):
        room = state["test_room"]
        old_pin = room["pin"]
        r = requests.post(f"{API}/rooms/{room['id']}/regenerate-pin", headers=auth_headers(admin_token), timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["pin"] != old_pin
        assert body["qr_image"].startswith("data:image/png;")


# ---------- Requests pipeline ----------
class TestRequests:
    def test_create_request_missing_pin_rejected(self):
        room = state["ceo_room"]
        cat = state["coffee_cat"]
        r = requests.post(
            f"{API}/requests",
            json={"room_id": room["id"], "category_id": cat["id"], "note": "TEST no pin"},
            timeout=10,
        )
        assert r.status_code == 403, r.text

    def test_create_request_wrong_pin_rejected(self):
        room = state["ceo_room"]
        cat = state["coffee_cat"]
        r = requests.post(
            f"{API}/requests",
            json={"room_id": room["id"], "category_id": cat["id"], "pin": "000000", "note": "TEST bad pin"},
            timeout=10,
        )
        assert r.status_code == 403, r.text

    def test_create_public_request(self):
        room = state["ceo_room"]
        cat = state["coffee_cat"]
        r = requests.post(
            f"{API}/requests",
            json={"room_id": room["id"], "category_id": cat["id"], "pin": room["pin"], "note": "TEST coffee please"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "requested"
        assert body["category_color"] == cat["color"]
        assert body["category_icon"] == cat["icon"]
        assert body["room_name"] == room["name"]
        assert body["department_id"]  # routing applied
        assert isinstance(body["history"], list) and body["history"][0]["status"] == "requested"
        state["req_id"] = body["id"]
        state["req_dept"] = body["department_id"]

    def test_list_requires_auth(self):
        assert requests.get(f"{API}/requests", timeout=10).status_code == 401

    def test_list_admin_sees_all(self, admin_token):
        r = requests.get(f"{API}/requests", headers=auth_headers(admin_token), timeout=10)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert state["req_id"] in ids

    def test_status_pipeline(self, admin_token):
        rid = state["req_id"]
        for s in ["accepted", "in_progress", "delivered", "closed"]:
            r = requests.patch(
                f"{API}/requests/{rid}/status",
                headers=auth_headers(admin_token),
                json={"status": s, "note": f"to {s}"},
                timeout=10,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == s
            ts_field = {"accepted": "accepted_at", "in_progress": "in_progress_at",
                        "delivered": "delivered_at", "closed": "closed_at"}[s]
            assert body[ts_field], f"missing {ts_field}"
        # history should have 5 entries total (1 initial + 4 transitions)
        r2 = requests.get(f"{API}/requests/{rid}", headers=auth_headers(admin_token), timeout=10)
        assert len(r2.json()["history"]) == 5


# ---------- Routing rules ----------
class TestRouting:
    def test_upsert_routing(self, admin_token):
        cat_id = state["test_cat_id"]
        new_dept = state["dept_by_name"]["IT Support"]
        r = requests.post(
            f"{API}/routing-rules",
            headers=auth_headers(admin_token),
            json={"category_id": cat_id, "department_id": new_dept, "escalation_minutes": 7},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["department_id"] == new_dept

        # New request now routed to IT Support
        room = state["ceo_room"]
        r2 = requests.post(
            f"{API}/requests",
            json={"room_id": room["id"], "category_id": cat_id, "pin": room["pin"], "note": "TEST routing"},
            timeout=10,
        )
        assert r2.status_code == 200
        assert r2.json()["department_id"] == new_dept


# ---------- Users (admin) ----------
class TestUsers:
    def test_non_admin_blocked(self, reception_token):
        r = requests.get(f"{API}/users", headers=auth_headers(reception_token), timeout=10)
        assert r.status_code == 403

    def test_admin_create_user(self, admin_token, default_location_id):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(
            f"{API}/users",
            headers=auth_headers(admin_token),
            json={"email": email, "password": "pw123456", "name": "TEST User", "role": "it_support",
                  "location_id": default_location_id},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == email
        assert "password_hash" not in body
        # verify by login
        r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": "pw123456"}, timeout=10)
        assert r2.status_code == 200


# ---------- Analytics ----------
class TestAnalytics:
    def test_overview(self, admin_token):
        r = requests.get(f"{API}/analytics/overview", headers=auth_headers(admin_token), timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ("total", "by_status", "top_categories", "by_hour", "by_day", "avg_response_seconds"):
            assert k in body
        assert isinstance(body["by_hour"], list) and len(body["by_hour"]) == 24

    def test_csv_export(self, admin_token):
        r = requests.get(f"{API}/analytics/export.csv", headers=auth_headers(admin_token), timeout=15)
        assert r.status_code == 200
        text = r.text
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)
        assert rows[0][0] == "id"
        assert "category_name" in rows[0]


# ---------- Socket.IO ----------
class TestSocketIO:
    def test_socketio_handshake(self):
        # polling handshake to /api/socket.io/?EIO=4&transport=polling
        url = f"{BASE_URL}/api/socket.io/?EIO=4&transport=polling"
        r = requests.get(url, timeout=10)
        assert r.status_code == 200, r.text
        # First polling frame starts with "0{" containing sid
        assert "sid" in r.text



# ---------- Iteration 2: New status-transition validation ----------
class TestStatusTransitionValidation:
    def _new_request(self):
        room = state["ceo_room"]
        cat = state["coffee_cat"]
        r = requests.post(
            f"{API}/requests",
            json={"room_id": room["id"], "category_id": cat["id"], "pin": room["pin"], "note": "TEST_trans"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_illegal_transition_blocked_for_non_admin(self, reception_token):
        rid = self._new_request()
        # requested -> delivered is NOT in STATUS_TRANSITIONS["requested"]
        r = requests.patch(
            f"{API}/requests/{rid}/status",
            headers=auth_headers(reception_token),
            json={"status": "delivered"},
            timeout=10,
        )
        assert r.status_code == 400, r.text

    def test_legal_transitions_pipeline(self, reception_token):
        rid = self._new_request()
        for s in ["accepted", "in_progress", "delivered", "closed"]:
            r = requests.patch(
                f"{API}/requests/{rid}/status",
                headers=auth_headers(reception_token),
                json={"status": s},
                timeout=10,
            )
            assert r.status_code == 200, f"{s}: {r.text}"
            assert r.json()["status"] == s

    def test_admin_can_bypass_transitions(self, admin_token):
        rid = self._new_request()
        r = requests.patch(
            f"{API}/requests/{rid}/status",
            headers=auth_headers(admin_token),
            json={"status": "delivered"},
            timeout=10,
        )
        assert r.status_code == 200, r.text


# ---------- Iteration 2: Analytics department scoping ----------
class TestAnalyticsScoping:
    def test_admin_sees_all(self, admin_token):
        r = requests.get(f"{API}/analytics/overview", headers=auth_headers(admin_token), timeout=10)
        assert r.status_code == 200
        state["admin_total"] = r.json()["total"]

    def test_non_admin_dept_scoped(self, cafeteria_token):
        r = requests.get(f"{API}/analytics/overview", headers=auth_headers(cafeteria_token), timeout=10)
        assert r.status_code == 200
        body = r.json()
        # cafeteria total should be <= admin total
        assert body["total"] <= state.get("admin_total", 10**9)


# ---------- Iteration 2: Departments PATCH ----------
class TestDepartmentPatch:
    def test_patch_dept(self, admin_token, default_location_id):
        # create then patch
        c = requests.post(
            f"{API}/departments",
            headers=auth_headers(admin_token),
            json={"name": f"TEST_Dept_{uuid.uuid4().hex[:6]}", "description": "x",
                  "location_id": default_location_id},
            timeout=10,
        )
        assert c.status_code == 200
        did = c.json()["id"]
        new_name = f"TEST_Dept_R_{uuid.uuid4().hex[:6]}"
        p = requests.patch(
            f"{API}/departments/{did}",
            headers=auth_headers(admin_token),
            json={"name": new_name, "description": "renamed"},
            timeout=10,
        )
        assert p.status_code == 200, p.text
        assert p.json()["name"] == new_name
        assert p.json()["description"] == "renamed"


# ---------- Iteration 2: Visitors ----------
class TestVisitors:
    def test_list_requires_auth(self):
        assert requests.get(f"{API}/visitors", timeout=10).status_code == 401

    def test_create_visitor_public(self, admin_token):
        room = state["ceo_room"]
        r = requests.post(
            f"{API}/visitors",
            json={"name": "TEST Visitor", "company": "Acme", "purpose": "Meeting",
                  "host_room_id": room["id"], "phone": "111"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "waiting"
        assert body["host_room_name"] == room["name"]
        state["visitor_id"] = body["id"]

    def test_visitor_status_transitions(self, reception_token):
        vid = state["visitor_id"]
        for s in ["notified", "checked_in", "checked_out"]:
            r = requests.patch(
                f"{API}/visitors/{vid}/status",
                headers=auth_headers(reception_token),
                json={"status": s},
                timeout=10,
            )
            assert r.status_code == 200, r.text
            assert r.json()["status"] == s

    def test_list_authenticated(self, admin_token):
        r = requests.get(f"{API}/visitors", headers=auth_headers(admin_token), timeout=10)
        assert r.status_code == 200
        ids = [v["id"] for v in r.json()]
        assert state["visitor_id"] in ids


# ---------- Iteration 2: Menu ----------
class TestMenu:
    def test_list_menu_public(self):
        r = requests.get(f"{API}/menu", timeout=10)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        state["menu_items"] = items

    def test_create_menu_item(self, admin_token, default_location_id):
        r = requests.post(
            f"{API}/menu",
            headers=auth_headers(admin_token),
            json={"name": f"TEST_Item_{uuid.uuid4().hex[:6]}", "price": 99, "category": "Snacks",
                  "location_id": default_location_id},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["available"] is True
        state["test_menu_item"] = body

    def test_toggle_available(self, admin_token):
        mid = state["test_menu_item"]["id"]
        r = requests.patch(
            f"{API}/menu/{mid}",
            headers=auth_headers(admin_token),
            json={"available": False},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["available"] is False


# ---------- Iteration 2: Pre-orders ----------
class TestPreorders:
    def test_create_preorder_requires_pin(self):
        room = state["ceo_room"]
        item = state["menu_items"][0]
        # wrong pin
        r = requests.post(
            f"{API}/preorders",
            json={"room_id": room["id"], "pin": "000000",
                  "items": [{"menu_item_id": item["id"], "name": item["name"], "qty": 1, "price": item["price"]}]},
            timeout=10,
        )
        assert r.status_code == 403

    def test_create_preorder_ok(self):
        room = state["ceo_room"]
        item = state["menu_items"][0]
        r = requests.post(
            f"{API}/preorders",
            json={"room_id": room["id"], "pin": room["pin"],
                  "items": [{"menu_item_id": item["id"], "name": item["name"], "qty": 2, "price": item["price"]}],
                  "note": "TEST preorder"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "pending"
        assert body["total"] == round(item["price"] * 2, 2)
        state["preorder_id"] = body["id"]

    def test_preorder_status_pipeline(self, cafeteria_token):
        oid = state["preorder_id"]
        for s in ["accepted", "preparing", "delivered"]:
            r = requests.patch(
                f"{API}/preorders/{oid}/status",
                headers=auth_headers(cafeteria_token),
                json={"status": s},
                timeout=10,
            )
            assert r.status_code == 200, f"{s}: {r.text}"
            assert r.json()["status"] == s

    def test_preorder_illegal_transition_blocked(self, cafeteria_token):
        """Iteration 3: PATCH preorders/{oid}/status now validates transitions."""
        # already delivered from previous test - cannot move to preparing
        oid = state["preorder_id"]
        r = requests.patch(
            f"{API}/preorders/{oid}/status",
            headers=auth_headers(cafeteria_token),
            json={"status": "preparing"},
            timeout=10,
        )
        assert r.status_code == 400, r.text

    def test_preorder_404_on_unknown_id(self, cafeteria_token):
        r = requests.patch(
            f"{API}/preorders/NO_SUCH_ID/status",
            headers=auth_headers(cafeteria_token),
            json={"status": "preparing"},
            timeout=10,
        )
        assert r.status_code == 404


# ---------- Iteration 2: IoT commands ----------
class TestIoT:
    def test_iot_command_requires_pin(self):
        room = state["ceo_room"]
        r = requests.post(
            f"{API}/iot/command",
            json={"room_id": room["id"], "pin": "000000", "device": "ac", "action": "on"},
            timeout=10,
        )
        assert r.status_code == 403

    def test_iot_command_ok(self):
        room = state["ceo_room"]
        r = requests.post(
            f"{API}/iot/command",
            json={"room_id": room["id"], "pin": room["pin"], "device": "light", "action": "on"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json()["device"] == "light"
        assert r.json()["action"] == "on"

    def test_list_commands_authenticated(self, admin_token):
        r = requests.get(f"{API}/iot/commands", headers=auth_headers(admin_token), timeout=10)
        assert r.status_code == 200
        assert any(c["device"] == "light" for c in r.json())

    def test_list_commands_requires_auth(self):
        assert requests.get(f"{API}/iot/commands", timeout=10).status_code == 401


# ---------- Iteration 2: Settings ----------
class TestSettings:
    def test_get_requires_admin(self, reception_token):
        r = requests.get(f"{API}/settings", headers=auth_headers(reception_token), timeout=10)
        assert r.status_code == 403

    def test_patch_and_persist(self, admin_token):
        slack_url = "https://hooks.slack.com/services/TEST/TEST/TEST"
        teams_url = "https://outlook.office.com/webhook/TEST"
        r = requests.patch(
            f"{API}/settings",
            headers=auth_headers(admin_token),
            json={"slack_webhook_url": slack_url, "teams_webhook_url": teams_url},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["slack_webhook_url"] == slack_url
        assert body["teams_webhook_url"] == teams_url

        # GET to verify persistence - iteration 3 masks secret URLs
        g = requests.get(f"{API}/settings", headers=auth_headers(admin_token), timeout=10)
        assert g.status_code == 200
        gb = g.json()
        # masked = "•" * 8 + last 4 chars
        assert gb["slack_webhook_url"] == "•" * 8 + slack_url[-4:]
        assert gb["teams_webhook_url"] == "•" * 8 + teams_url[-4:]



# ---------- Iteration 3: Background escalation worker ----------
class TestEscalationWorker:
    """Insert a stale request directly into Mongo, wait for the worker (30s interval)
    to flip its status to 'escalated', then verify history + escalated_at + status.
    """

    def _mongo_db(self):
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
            # Read from backend/.env
            with open("/app/backend/.env") as f:
                for line in f:
                    if line.startswith("MONGO_URL="):
                        mongo_url = line.split("=", 1)[1].strip().strip('"').rstrip("\n")
                    elif line.startswith("DB_NAME="):
                        db_name = line.split("=", 1)[1].strip().strip('"').rstrip("\n")
        return MongoClient(mongo_url)[db_name]

    def test_stale_request_auto_escalated(self, admin_token):
        from datetime import datetime, timedelta, timezone
        mdb = self._mongo_db()
        rid = f"ESC_TEST_{uuid.uuid4().hex[:8]}"
        old_created = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        # category + dept can be any seeded values - pick one
        room = state.get("ceo_room")
        if not room:
            r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=20)
            r2 = requests.get(f"{API}/rooms", headers=auth_headers(r.json()["token"]), timeout=10)
            room = next((rm for rm in r2.json() if rm["name"] == "CEO Cabin"), r2.json()[0])
        cat = requests.get(f"{API}/categories", timeout=10).json()[0]
        doc = {
            "id": rid,
            "room_id": room["id"], "room_name": room["name"],
            "category_id": cat["id"], "category_name": cat["name"],
            "department_id": cat.get("department_id"),
            "priority": "normal", "status": "requested",
            "note": "TEST escalation worker", "created_at": old_created,
            "escalation_minutes": 1,
            "history": [{"status": "requested", "at": old_created, "by": "kiosk"}],
        }
        mdb.requests.insert_one(doc)
        try:
            # worker runs every 30s; wait up to 75s
            escalated = False
            for _ in range(15):
                time.sleep(5)
                row = mdb.requests.find_one({"id": rid})
                if row and row.get("status") == "escalated":
                    escalated = True
                    break
            assert escalated, f"request {rid} not escalated within 75s"
            row = mdb.requests.find_one({"id": rid})
            assert row["status"] == "escalated"
            assert row.get("escalated_at"), "escalated_at not set"
            sys_entry = next((h for h in row.get("history", []) if h.get("by") == "system"), None)
            assert sys_entry is not None, "no system history entry"
            assert "auto-escalated after" in sys_entry.get("note", "")
            assert sys_entry["status"] == "escalated"

            # And the API view should also reflect escalation
            api_row = requests.get(
                f"{API}/requests", headers=auth_headers(admin_token), timeout=10
            ).json()
            api_match = next((r for r in api_row if r["id"] == rid), None)
            assert api_match is not None
            assert api_match["status"] == "escalated"
        finally:
            mdb.requests.delete_one({"id": rid})

    def test_fresh_request_not_escalated(self):
        """A brand-new request should NOT be flipped by the worker."""
        from datetime import datetime, timezone
        mdb = self._mongo_db()
        rid = f"ESC_FRESH_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc).isoformat()
        mdb.requests.insert_one({
            "id": rid, "room_id": "r", "room_name": "r",
            "category_id": "c", "category_name": "c", "department_id": None,
            "priority": "normal", "status": "requested",
            "note": "TEST fresh", "created_at": now,
            "escalation_minutes": 15,
            "history": [{"status": "requested", "at": now, "by": "kiosk"}],
        })
        try:
            time.sleep(35)  # one worker tick
            row = mdb.requests.find_one({"id": rid})
            assert row["status"] == "requested", "fresh request was incorrectly escalated"
        finally:
            mdb.requests.delete_one({"id": rid})


# ---------- Iteration 4: Failed dispatches admin visibility ----------
class TestFailedDispatches:
    """Bogus Slack webhook URL → request creation → failed_dispatch row persisted.
    Then exercises GET (open + include_resolved), PATCH /{id}/resolve, DELETE bulk-clear.
    Cleans up slack_webhook_url back to '' in teardown so other tests don't hit bogus URL.
    """

    BOGUS_URL = "http://127.0.0.1:1/bogus"

    def _settings_patch(self, admin_token, payload):
        return requests.patch(
            f"{API}/settings", headers=auth_headers(admin_token),
            json=payload, timeout=10,
        )

    def _list_failures(self, admin_token, include_resolved=False):
        return requests.get(
            f"{API}/settings/failed-dispatches",
            headers=auth_headers(admin_token),
            params={"include_resolved": str(include_resolved).lower()},
            timeout=10,
        )

    def test_list_requires_admin(self, reception_token):
        r = requests.get(
            f"{API}/settings/failed-dispatches",
            headers=auth_headers(reception_token), timeout=10,
        )
        assert r.status_code == 403

    def test_resolve_404_on_missing_id(self, admin_token):
        r = requests.patch(
            f"{API}/settings/failed-dispatches/NO_SUCH_ID/resolve",
            headers=auth_headers(admin_token), timeout=10,
        )
        assert r.status_code == 404

    def test_no_failure_when_webhooks_empty(self, admin_token):
        # 1) Ensure slack url empty + clear any old failures
        self._settings_patch(admin_token, {"slack_webhook_url": "", "teams_webhook_url": ""})
        d = requests.delete(
            f"{API}/settings/failed-dispatches",
            headers=auth_headers(admin_token),
            params={"only_resolved": "false"}, timeout=10,
        )
        assert d.status_code == 200
        # 2) Create a request (no webhooks → only socket emit)
        room = state["ceo_room"]; cat = state["coffee_cat"]
        r = requests.post(
            f"{API}/requests",
            json={"room_id": room["id"], "category_id": cat["id"],
                  "pin": room["pin"], "note": "TEST_no_fail"},
            timeout=10,
        )
        assert r.status_code == 200
        time.sleep(1.0)
        # 3) Failed dispatches should still be empty
        lst = self._list_failures(admin_token, include_resolved=True)
        assert lst.status_code == 200
        assert len(lst.json()) == 0, f"unexpected failures: {lst.json()}"

    def test_bogus_slack_records_failure_full_cycle(self, admin_token):
        """End-to-end: bogus slack URL → request → failed_dispatch row → resolve → clear."""
        # 1) Set bogus slack URL
        p = self._settings_patch(admin_token, {"slack_webhook_url": self.BOGUS_URL})
        assert p.status_code == 200
        try:
            # 2) Trigger a request to fire notification → fail
            room = state["ceo_room"]; cat = state["coffee_cat"]
            r = requests.post(
                f"{API}/requests",
                json={"room_id": room["id"], "category_id": cat["id"],
                      "pin": room["pin"], "note": "TEST_bogus_slack"},
                timeout=15,
            )
            assert r.status_code == 200
            payload_id = r.json()["id"]
            # 3) Wait briefly for async webhook to fail and persist
            time.sleep(3)
            lst = self._list_failures(admin_token, include_resolved=False).json()
            slack_fails = [f for f in lst if f.get("channel") == "slack" and f.get("payload_id") == payload_id]
            assert slack_fails, f"no slack failure recorded for {payload_id}; got {lst}"
            f0 = slack_fails[0]
            # 4) Shape assertions
            for k in ("id", "channel", "event", "error", "payload_id", "resolved", "created_at"):
                assert k in f0, f"missing field {k} in {f0}"
            assert f0["channel"] == "slack"
            assert f0["event"] == "new_request"
            assert f0["resolved"] is False
            assert "_id" not in f0
            assert isinstance(f0["error"], str) and len(f0["error"]) > 0
            fid = f0["id"]
            # 5) Resolve
            rs = requests.patch(
                f"{API}/settings/failed-dispatches/{fid}/resolve",
                headers=auth_headers(admin_token), timeout=10,
            )
            assert rs.status_code == 200
            assert rs.json()["resolved"] is True
            # 6) Default list (open only) should no longer show it
            open_only = self._list_failures(admin_token, include_resolved=False).json()
            assert not any(x["id"] == fid for x in open_only)
            # 7) include_resolved=true should show it
            all_ = self._list_failures(admin_token, include_resolved=True).json()
            assert any(x["id"] == fid and x["resolved"] for x in all_)
            # 8) Clear only_resolved=true → removes resolved one
            d = requests.delete(
                f"{API}/settings/failed-dispatches",
                headers=auth_headers(admin_token),
                params={"only_resolved": "true"}, timeout=10,
            )
            assert d.status_code == 200
            assert d.json()["deleted"] >= 1
        finally:
            # ALWAYS restore slack URL to '' so subsequent tests don't keep hitting bogus URL
            self._settings_patch(admin_token, {"slack_webhook_url": ""})
            # nuke any leftover failures from this test
            requests.delete(
                f"{API}/settings/failed-dispatches",
                headers=auth_headers(admin_token),
                params={"only_resolved": "false"}, timeout=10,
            )

    def test_clear_bulk_only_resolved_false_wipes_all(self, admin_token):
        # Create 2 bogus failures, then bulk clear without only_resolved
        self._settings_patch(admin_token, {"slack_webhook_url": self.BOGUS_URL})
        try:
            room = state["ceo_room"]; cat = state["coffee_cat"]
            for _ in range(2):
                requests.post(
                    f"{API}/requests",
                    json={"room_id": room["id"], "category_id": cat["id"],
                          "pin": room["pin"], "note": "TEST_bulk_clear"},
                    timeout=15,
                )
            time.sleep(3)
            before = self._list_failures(admin_token, include_resolved=True).json()
            assert len(before) >= 2
            d = requests.delete(
                f"{API}/settings/failed-dispatches",
                headers=auth_headers(admin_token),
                params={"only_resolved": "false"}, timeout=10,
            )
            assert d.status_code == 200
            assert d.json()["deleted"] >= 2
            after = self._list_failures(admin_token, include_resolved=True).json()
            assert len(after) == 0
        finally:
            self._settings_patch(admin_token, {"slack_webhook_url": ""})

