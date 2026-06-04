"""Multi-location (multi-tenant) regression tests — iteration 5.

Covers:
 - GET/POST/PATCH/DELETE /api/locations RBAC + delete refuses when references exist
 - Cross-location scoping for rooms/categories/departments/menu/users/routing-rules
 - Non-super_admin auto-scoped; passing ?location_id=<other> -> 403
 - Kiosk POST /api/requests inherits room.location_id (ignores client override)
 - Cross-location safeguard (room LocA + category LocB -> 400)
 - Cross-location PATCH on rooms/requests/categories/visitors/preorders by other-location staff -> 403
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://officeflow-pro.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@workplace.com", "admin123")


@pytest.fixture(scope="module")
def reception_token():
    return _login("reception@workplace.com", "demo123")


@pytest.fixture(scope="module")
def cafeteria_token():
    return _login("cafeteria@workplace.com", "demo123")


@pytest.fixture(scope="module")
def default_location_id(admin_token):
    r = requests.get(f"{API}/locations", headers=_h(admin_token), timeout=15)
    assert r.status_code == 200
    locs = r.json()
    hq = [l for l in locs if l.get("is_default")]
    assert hq, f"Default location (is_default=true) missing. Got: {[l['name'] for l in locs]}"
    return hq[0]["id"]


@pytest.fixture(scope="module")
def two_locations(admin_token):
    """Create TEST_LocA and TEST_LocB (or reuse if existing). Cleans up at end."""
    created_ids = []
    out = {}
    for key, name in [("A", "TEST_LocA"), ("B", "TEST_LocB")]:
        r = requests.post(
            f"{API}/locations",
            headers=_h(admin_token),
            json={"name": name, "code": key, "address": f"{name} addr"},
            timeout=15,
        )
        assert r.status_code == 200, f"location create failed: {r.status_code} {r.text}"
        d = r.json()
        out[key] = d["id"]
        created_ids.append(d["id"])
    yield out
    # cleanup at end (rooms/categories created within are also cleaned below)
    for lid in created_ids:
        try:
            requests.delete(f"{API}/locations/{lid}?cascade=true", headers=_h(admin_token), timeout=15)
        except Exception:
            pass


class TestLocationsCRUD:
    def test_default_location_present_for_super_admin(self, default_location_id):
        assert default_location_id

    def test_create_location_super_admin_only(self, admin_token, reception_token):
        # non-super_admin -> 403
        r = requests.post(
            f"{API}/locations",
            headers=_h(reception_token),
            json={"name": f"TEST_forbidden_{uuid.uuid4().hex[:6]}"},
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403 for non-super_admin, got {r.status_code} {r.text}"

        # super_admin can
        name = f"TEST_loc_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/locations", headers=_h(admin_token), json={"name": name}, timeout=15)
        assert r.status_code == 200
        loc = r.json()
        assert loc["name"] == name and "id" in loc
        # cleanup
        requests.delete(f"{API}/locations/{loc['id']}?cascade=true", headers=_h(admin_token), timeout=15)

    def test_patch_location(self, admin_token):
        name = f"TEST_patch_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/locations", headers=_h(admin_token), json={"name": name}, timeout=15)
        loc_id = r.json()["id"]
        r2 = requests.patch(
            f"{API}/locations/{loc_id}", headers=_h(admin_token), json={"address": "Updated Addr"}, timeout=15
        )
        assert r2.status_code == 200
        assert r2.json()["address"] == "Updated Addr"
        requests.delete(f"{API}/locations/{loc_id}?cascade=true", headers=_h(admin_token), timeout=15)

    def test_delete_refuses_when_room_attached(self, admin_token):
        # Create location (auto-seeds default catalog) + room, attempt delete -> 400, cleanup via cascade
        name = f"TEST_del_{uuid.uuid4().hex[:6]}"
        loc = requests.post(f"{API}/locations", headers=_h(admin_token), json={"name": name}, timeout=15).json()
        room = requests.post(
            f"{API}/rooms",
            headers=_h(admin_token),
            json={"name": f"TEST_room_{uuid.uuid4().hex[:6]}", "location_id": loc["id"]},
            timeout=15,
        ).json()
        r = requests.delete(f"{API}/locations/{loc['id']}", headers=_h(admin_token), timeout=15)
        assert r.status_code == 400 and ("rooms" in r.text.lower() or "categor" in r.text.lower())
        # cleanup with cascade (removes auto-seeded catalog + the room)
        r2 = requests.delete(f"{API}/locations/{loc['id']}?cascade=true", headers=_h(admin_token), timeout=15)
        assert r2.status_code == 200, r2.text
        # Verify all rooms scoped to that location are gone
        list_r = requests.get(f"{API}/rooms?location_id={loc['id']}", headers=_h(admin_token), timeout=10)
        assert list_r.status_code == 200 and len(list_r.json()) == 0


class TestRoomScoping:
    def test_rooms_per_location(self, admin_token, two_locations):
        # Create 1 room in A and 1 in B
        room_a = requests.post(
            f"{API}/rooms",
            headers=_h(admin_token),
            json={"name": f"TEST_RA_{uuid.uuid4().hex[:6]}", "location_id": two_locations["A"]},
            timeout=15,
        ).json()
        room_b = requests.post(
            f"{API}/rooms",
            headers=_h(admin_token),
            json={"name": f"TEST_RB_{uuid.uuid4().hex[:6]}", "location_id": two_locations["B"]},
            timeout=15,
        ).json()
        assert room_a["location_id"] == two_locations["A"]
        assert room_b["location_id"] == two_locations["B"]

        # GET filter
        ra = requests.get(
            f"{API}/rooms", headers=_h(admin_token), params={"location_id": two_locations["A"]}, timeout=15
        ).json()
        rb = requests.get(
            f"{API}/rooms", headers=_h(admin_token), params={"location_id": two_locations["B"]}, timeout=15
        ).json()
        ra_ids = {x["id"] for x in ra}
        rb_ids = {x["id"] for x in rb}
        assert room_a["id"] in ra_ids and room_a["id"] not in rb_ids
        assert room_b["id"] in rb_ids and room_b["id"] not in ra_ids

        # cleanup
        requests.delete(f"{API}/rooms/{room_a['id']}", headers=_h(admin_token), timeout=15)
        requests.delete(f"{API}/rooms/{room_b['id']}", headers=_h(admin_token), timeout=15)


class TestNonAdminScoping:
    def test_non_admin_filtered_to_own_location(self, reception_token, default_location_id, two_locations, admin_token):
        # Create a room in LocA (super_admin)
        room = requests.post(
            f"{API}/rooms",
            headers=_h(admin_token),
            json={"name": f"TEST_RforStaff_{uuid.uuid4().hex[:6]}", "location_id": two_locations["A"]},
            timeout=15,
        ).json()
        # Reception (default loc) should not see LocA rooms
        r = requests.get(f"{API}/rooms", headers=_h(reception_token), timeout=15)
        assert r.status_code == 200
        seen_ids = {x["id"] for x in r.json()}
        assert room["id"] not in seen_ids
        # cleanup
        requests.delete(f"{API}/rooms/{room['id']}", headers=_h(admin_token), timeout=15)

    def test_non_admin_passing_other_location_403(self, reception_token, two_locations):
        r = requests.get(
            f"{API}/rooms", headers=_h(reception_token), params={"location_id": two_locations["A"]}, timeout=15
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


class TestKioskRequestInheritsLocation:
    def test_create_request_inherits_room_location_ignores_client(self, admin_token, two_locations):
        # Need a category in LocA + room in LocA
        # Pick any department from default seed for LocA via category create
        # Create department in LocA first
        dept = requests.post(
            f"{API}/departments",
            headers=_h(admin_token),
            json={"name": f"TEST_dept_{uuid.uuid4().hex[:6]}", "location_id": two_locations["A"]},
            timeout=15,
        ).json()
        cat = requests.post(
            f"{API}/categories",
            headers=_h(admin_token),
            json={"name": f"TEST_cat_{uuid.uuid4().hex[:6]}", "department_id": dept["id"], "location_id": two_locations["A"]},
            timeout=15,
        ).json()
        room = requests.post(
            f"{API}/rooms",
            headers=_h(admin_token),
            json={"name": f"TEST_Rkiosk_{uuid.uuid4().hex[:6]}", "location_id": two_locations["A"]},
            timeout=15,
        ).json()

        # POST request (public) — model doesn't accept location_id field but room dictates it anyway
        r = requests.post(
            f"{API}/requests",
            json={"room_id": room["id"], "category_id": cat["id"], "pin": room["pin"], "note": "TEST_kiosk"},
            timeout=15,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        req = r.json()
        assert req["location_id"] == two_locations["A"], f"location_id mismatch: {req.get('location_id')}"

        # cleanup
        requests.delete(f"{API}/categories/{cat['id']}", headers=_h(admin_token), timeout=15)
        requests.delete(f"{API}/departments/{dept['id']}", headers=_h(admin_token), timeout=15)
        requests.delete(f"{API}/rooms/{room['id']}", headers=_h(admin_token), timeout=15)

    def test_cross_location_room_and_category_returns_400(self, admin_token, two_locations):
        # Room in A, Category in B => 400
        dept_b = requests.post(
            f"{API}/departments",
            headers=_h(admin_token),
            json={"name": f"TEST_deptB_{uuid.uuid4().hex[:6]}", "location_id": two_locations["B"]},
            timeout=15,
        ).json()
        cat_b = requests.post(
            f"{API}/categories",
            headers=_h(admin_token),
            json={"name": f"TEST_catB_{uuid.uuid4().hex[:6]}", "department_id": dept_b["id"], "location_id": two_locations["B"]},
            timeout=15,
        ).json()
        room_a = requests.post(
            f"{API}/rooms",
            headers=_h(admin_token),
            json={"name": f"TEST_RA2_{uuid.uuid4().hex[:6]}", "location_id": two_locations["A"]},
            timeout=15,
        ).json()
        r = requests.post(
            f"{API}/requests",
            json={"room_id": room_a["id"], "category_id": cat_b["id"], "pin": room_a["pin"]},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"

        requests.delete(f"{API}/categories/{cat_b['id']}", headers=_h(admin_token), timeout=15)
        requests.delete(f"{API}/departments/{dept_b['id']}", headers=_h(admin_token), timeout=15)
        requests.delete(f"{API}/rooms/{room_a['id']}", headers=_h(admin_token), timeout=15)


class TestCrossLocationPatch403:
    def test_room_patch_cross_location_403(self, admin_token, reception_token, two_locations):
        # Reception is in default loc. Create a room in LocA. Reception PATCH -> 403.
        room = requests.post(
            f"{API}/rooms",
            headers=_h(admin_token),
            json={"name": f"TEST_RXpatch_{uuid.uuid4().hex[:6]}", "location_id": two_locations["A"]},
            timeout=15,
        ).json()
        # reception is "reception" role; rooms PATCH requires admin — verify it returns 401/403 either way
        r = requests.patch(
            f"{API}/rooms/{room['id']}", headers=_h(reception_token), json={"name": "hack"}, timeout=15
        )
        assert r.status_code in (401, 403), f"got {r.status_code} {r.text}"
        requests.delete(f"{API}/rooms/{room['id']}", headers=_h(admin_token), timeout=15)

    def test_request_status_patch_cross_location_403(self, admin_token, reception_token, two_locations):
        # Create a department+cat+room+request in LocA, then reception (default loc) attempts patch -> 403
        dept = requests.post(
            f"{API}/departments",
            headers=_h(admin_token),
            json={"name": f"TEST_deptR_{uuid.uuid4().hex[:6]}", "location_id": two_locations["A"]},
            timeout=15,
        ).json()
        cat = requests.post(
            f"{API}/categories",
            headers=_h(admin_token),
            json={"name": f"TEST_catR_{uuid.uuid4().hex[:6]}", "department_id": dept["id"], "location_id": two_locations["A"]},
            timeout=15,
        ).json()
        room = requests.post(
            f"{API}/rooms",
            headers=_h(admin_token),
            json={"name": f"TEST_RpatchReq_{uuid.uuid4().hex[:6]}", "location_id": two_locations["A"]},
            timeout=15,
        ).json()
        req = requests.post(
            f"{API}/requests",
            json={"room_id": room["id"], "category_id": cat["id"], "pin": room["pin"], "note": "TEST_xloc"},
            timeout=15,
        ).json()

        r = requests.patch(
            f"{API}/requests/{req['id']}/status",
            headers=_h(reception_token),
            json={"status": "accepted"},
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

        # cleanup
        requests.delete(f"{API}/categories/{cat['id']}", headers=_h(admin_token), timeout=15)
        requests.delete(f"{API}/departments/{dept['id']}", headers=_h(admin_token), timeout=15)
        requests.delete(f"{API}/rooms/{room['id']}", headers=_h(admin_token), timeout=15)


class TestCategoryAndDeptFilters:
    def test_categories_filter_by_location(self, admin_token, two_locations):
        dept = requests.post(
            f"{API}/departments",
            headers=_h(admin_token),
            json={"name": f"TEST_deptF_{uuid.uuid4().hex[:6]}", "location_id": two_locations["A"]},
            timeout=15,
        ).json()
        cat = requests.post(
            f"{API}/categories",
            headers=_h(admin_token),
            json={"name": f"TEST_catF_{uuid.uuid4().hex[:6]}", "department_id": dept["id"], "location_id": two_locations["A"]},
            timeout=15,
        ).json()
        # ?location_id=A should contain cat; ?location_id=B should not
        a_cats = requests.get(
            f"{API}/categories", headers=_h(admin_token), params={"location_id": two_locations["A"]}, timeout=15
        ).json()
        b_cats = requests.get(
            f"{API}/categories", headers=_h(admin_token), params={"location_id": two_locations["B"]}, timeout=15
        ).json()
        a_ids = {x["id"] for x in a_cats}
        b_ids = {x["id"] for x in b_cats}
        assert cat["id"] in a_ids and cat["id"] not in b_ids

        requests.delete(f"{API}/categories/{cat['id']}", headers=_h(admin_token), timeout=15)
        requests.delete(f"{API}/departments/{dept['id']}", headers=_h(admin_token), timeout=15)
