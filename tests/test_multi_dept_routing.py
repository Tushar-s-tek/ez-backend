"""Multi-department routing regression tests.

Covers:
 - POST /api/routing-rules accepts department_ids (list) and stores both
   department_id (primary) + department_ids
 - Backward-compat: legacy single department_id is promoted to department_ids
 - Kiosk POST /api/requests persists department_ids on the request
 - Staff whose department_id is in department_ids (but NOT the primary) can
   still see the request via GET /api/requests
 - Staff whose department_id is NOT in department_ids cannot see it
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://officeflow-pro.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@workplace.com", "admin123")


@pytest.fixture(scope="module")
def default_location_id(admin_token):
    r = requests.get(f"{API}/locations", headers=_h(admin_token), timeout=15)
    assert r.status_code == 200
    hq = [loc for loc in r.json() if loc.get("is_default")]
    assert hq, "default location missing"
    return hq[0]["id"]


@pytest.fixture(scope="module")
def dept_ids(admin_token, default_location_id):
    r = requests.get(f"{API}/departments", headers=_h(admin_token), params={"location_id": default_location_id}, timeout=15)
    out = {d["name"]: d["id"] for d in r.json()}
    assert {"Cafeteria", "Reception", "IT Support"}.issubset(out.keys()), f"missing seeded depts: {list(out.keys())}"
    return out


@pytest.fixture(scope="module")
def coffee_category(admin_token, default_location_id):
    r = requests.get(f"{API}/categories", headers=_h(admin_token), params={"location_id": default_location_id}, timeout=15)
    cats = [c for c in r.json() if c["name"] == "Coffee"]
    assert cats, "Coffee category missing"
    return cats[0]


@pytest.fixture(scope="module")
def ceo_room(admin_token, default_location_id):
    r = requests.get(f"{API}/rooms", headers=_h(admin_token), params={"location_id": default_location_id}, timeout=15)
    rooms = [x for x in r.json() if x["name"] == "CEO Cabin"]
    assert rooms, "CEO Cabin missing"
    return rooms[0]


def test_routing_rule_accepts_department_ids(admin_token, coffee_category, dept_ids):
    """POST /api/routing-rules with department_ids list stores both primary + list."""
    payload = {
        "category_id": coffee_category["id"],
        "department_ids": [dept_ids["Reception"], dept_ids["Cafeteria"]],
        "escalation_minutes": 15,
    }
    r = requests.post(f"{API}/routing-rules", headers=_h(admin_token), json=payload, timeout=15)
    assert r.status_code == 200, r.text
    rule = r.json()
    assert rule["department_id"] == dept_ids["Reception"], "primary should be first element"
    assert rule["department_ids"] == [dept_ids["Reception"], dept_ids["Cafeteria"]]


def test_routing_rule_accepts_legacy_single_field(admin_token, coffee_category, dept_ids):
    """Backward compat: POST with only `department_id` still works and gets promoted."""
    payload = {
        "category_id": coffee_category["id"],
        "department_id": dept_ids["Cafeteria"],
        "escalation_minutes": 15,
    }
    r = requests.post(f"{API}/routing-rules", headers=_h(admin_token), json=payload, timeout=15)
    assert r.status_code == 200, r.text
    rule = r.json()
    assert rule["department_id"] == dept_ids["Cafeteria"]
    assert rule["department_ids"] == [dept_ids["Cafeteria"]]


def test_routing_rule_rejects_empty(admin_token, coffee_category):
    """Cannot save a routing rule with no departments."""
    payload = {"category_id": coffee_category["id"], "department_ids": [], "escalation_minutes": 15}
    r = requests.post(f"{API}/routing-rules", headers=_h(admin_token), json=payload, timeout=15)
    assert r.status_code == 400


def test_multi_dept_request_visibility(admin_token, coffee_category, dept_ids, ceo_room):
    """Staff in EITHER dept_ids entry can see the request; unrelated dept cannot."""
    # Route Coffee → [Reception (primary), Cafeteria]
    requests.post(
        f"{API}/routing-rules",
        headers=_h(admin_token),
        json={
            "category_id": coffee_category["id"],
            "department_ids": [dept_ids["Reception"], dept_ids["Cafeteria"]],
            "escalation_minutes": 15,
        },
        timeout=15,
    )

    # Kiosk creates a request
    payload = {
        "room_id": ceo_room["id"], "category_id": coffee_category["id"],
        "pin": ceo_room["pin"], "note": "TEST_multi_dept_routing",
    }
    r = requests.post(f"{API}/requests", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    req = r.json()
    assert req["department_id"] == dept_ids["Reception"]
    assert req["department_ids"] == [dept_ids["Reception"], dept_ids["Cafeteria"]]
    req_id = req["id"]

    # Cafeteria staff — department NOT the primary — MUST see the request
    cafe = _login("cafeteria@workplace.com", "demo123")
    r = requests.get(f"{API}/requests", headers=_h(cafe), params={"status": "requested"}, timeout=15)
    assert r.status_code == 200
    assert any(x["id"] == req_id for x in r.json()), "Cafeteria staff did not see the multi-dept routed request"

    # Reception staff — primary — MUST see the request
    rec = _login("reception@workplace.com", "demo123")
    r = requests.get(f"{API}/requests", headers=_h(rec), params={"status": "requested"}, timeout=15)
    assert any(x["id"] == req_id for x in r.json()), "Reception staff did not see the request"

    # IT staff — NOT in dept_ids — MUST NOT see the request
    it = _login("it@workplace.com", "demo123")
    r = requests.get(f"{API}/requests", headers=_h(it), params={"status": "requested"}, timeout=15)
    assert not any(x["id"] == req_id for x in r.json()), "IT staff incorrectly saw a request not routed to them"

    # Cleanup: close it so the queue stays clean for other tests
    requests.patch(
        f"{API}/requests/{req_id}/status",
        headers=_h(admin_token),
        json={"status": "closed", "note": "TEST_cleanup"},
        timeout=15,
    )


def test_multi_dept_filter_by_explicit_department_id(admin_token, coffee_category, dept_ids, ceo_room):
    """Admin querying ?department_id=<id> returns requests where id is in either field."""
    # Route Coffee → [Cafeteria, Reception]
    requests.post(
        f"{API}/routing-rules",
        headers=_h(admin_token),
        json={
            "category_id": coffee_category["id"],
            "department_ids": [dept_ids["Cafeteria"], dept_ids["Reception"]],
            "escalation_minutes": 15,
        },
        timeout=15,
    )
    payload = {
        "room_id": ceo_room["id"], "category_id": coffee_category["id"],
        "pin": ceo_room["pin"], "note": "TEST_filter_explicit",
    }
    r = requests.post(f"{API}/requests", json=payload, timeout=15)
    req_id = r.json()["id"]

    # Filter by the secondary dept — should still see this request
    r = requests.get(
        f"{API}/requests",
        headers=_h(admin_token),
        params={"department_id": dept_ids["Reception"], "status": "requested"},
        timeout=15,
    )
    assert any(x["id"] == req_id for x in r.json()), "filter by secondary dept_id missed the request"

    # Cleanup
    requests.patch(
        f"{API}/requests/{req_id}/status",
        headers=_h(admin_token),
        json={"status": "closed", "note": "TEST_cleanup"},
        timeout=15,
    )
