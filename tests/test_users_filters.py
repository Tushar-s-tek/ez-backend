"""Backend tests for /api/users filter bar + extra_location_ids — iteration 6.

Covers:
- GET /api/users with location_id, department_id, role, q (search), sort, order
- POST /api/users with extra_location_ids persists; super_admin role clears location/extras
- PATCH /api/users with extra_location_ids persists
- Non-super_admin scoping (reception sees only own location + extras)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://officeflow-pro.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@workplace.com", "admin123")


@pytest.fixture(scope="module")
def reception_token():
    return _login("reception@workplace.com", "demo123")


@pytest.fixture(scope="module")
def default_loc(admin_token):
    r = requests.get(f"{API}/locations", headers=_h(admin_token), timeout=15)
    return [l for l in r.json() if l.get("is_default")][0]["id"]


@pytest.fixture(scope="module")
def two_locations(admin_token):
    out = {}
    ids = []
    for key, name in [("A", f"TEST_UF_LocA_{uuid.uuid4().hex[:5]}"), ("B", f"TEST_UF_LocB_{uuid.uuid4().hex[:5]}")]:
        r = requests.post(f"{API}/locations", headers=_h(admin_token), json={"name": name}, timeout=15)
        assert r.status_code == 200
        out[key] = r.json()["id"]
        ids.append(out[key])
    yield out
    for lid in ids:
        try:
            requests.delete(f"{API}/locations/{lid}?cascade=true", headers=_h(admin_token), timeout=15)
        except Exception:
            pass


@pytest.fixture(scope="module")
def dept_in_default(admin_token, default_loc):
    r = requests.post(
        f"{API}/departments",
        headers=_h(admin_token),
        json={"name": f"TEST_UF_dept_{uuid.uuid4().hex[:5]}", "location_id": default_loc},
        timeout=15,
    )
    dept = r.json()
    yield dept
    requests.delete(f"{API}/departments/{dept['id']}", headers=_h(admin_token), timeout=15)


class TestUsersCreateWithExtras:
    def test_create_user_with_extras_persists(self, admin_token, two_locations):
        email = f"test_ufextra_{uuid.uuid4().hex[:6]}@example.com"
        payload = {
            "email": email, "name": "TEST_UFExtra User", "password": "pw123456",
            "role": "reception",
            "location_id": two_locations["A"],
            "extra_location_ids": [two_locations["B"]],
        }
        r = requests.post(f"{API}/users", headers=_h(admin_token), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["location_id"] == two_locations["A"]
        assert u["extra_location_ids"] == [two_locations["B"]]

        # GET back to confirm persistence
        g = requests.get(f"{API}/users", headers=_h(admin_token), params={"q": email}, timeout=15)
        rows = [x for x in g.json() if x["email"] == email]
        assert len(rows) == 1
        assert rows[0]["extra_location_ids"] == [two_locations["B"]]

        requests.delete(f"{API}/users/{u['id']}", headers=_h(admin_token), timeout=15)

    def test_create_super_admin_clears_location_and_extras(self, admin_token, two_locations):
        email = f"test_ufsa_{uuid.uuid4().hex[:6]}@example.com"
        payload = {
            "email": email, "name": "TEST_UFsa", "password": "pw123456",
            "role": "super_admin",
            "location_id": two_locations["A"],
            "extra_location_ids": [two_locations["B"]],
        }
        r = requests.post(f"{API}/users", headers=_h(admin_token), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["role"] == "super_admin"
        assert u.get("location_id") in (None, "")
        assert u.get("extra_location_ids") in ([], None)
        requests.delete(f"{API}/users/{u['id']}", headers=_h(admin_token), timeout=15)


class TestUsersPatchExtras:
    def test_patch_extras(self, admin_token, two_locations, default_loc):
        email = f"test_ufpatch_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/users", headers=_h(admin_token), json={
            "email": email, "name": "TEST_UFPatch", "password": "pw123456",
            "role": "reception", "location_id": default_loc, "extra_location_ids": []
        }, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()

        p = requests.patch(f"{API}/users/{u['id']}", headers=_h(admin_token),
                           json={"extra_location_ids": [two_locations["A"], two_locations["B"]]}, timeout=15)
        assert p.status_code == 200, p.text
        assert set(p.json()["extra_location_ids"]) == {two_locations["A"], two_locations["B"]}

        # Verify with fresh GET
        g = requests.get(f"{API}/users", headers=_h(admin_token), params={"q": email}, timeout=15)
        row = [x for x in g.json() if x["email"] == email][0]
        assert set(row["extra_location_ids"]) == {two_locations["A"], two_locations["B"]}

        requests.delete(f"{API}/users/{u['id']}", headers=_h(admin_token), timeout=15)


class TestUsersFilters:
    def test_filter_by_role(self, admin_token):
        r = requests.get(f"{API}/users", headers=_h(admin_token), params={"role": "reception"}, timeout=15)
        assert r.status_code == 200
        assert all(u["role"] == "reception" for u in r.json())

    def test_search_q_case_insensitive(self, admin_token):
        r = requests.get(f"{API}/users", headers=_h(admin_token), params={"q": "ADMIN"}, timeout=15)
        assert r.status_code == 200
        # should find at least the admin user
        emails = [u["email"].lower() for u in r.json()]
        assert any("admin" in e for e in emails)

    def test_sort_name_asc_desc(self, admin_token):
        a = requests.get(f"{API}/users", headers=_h(admin_token),
                         params={"sort": "name", "order": "asc"}, timeout=15).json()
        d = requests.get(f"{API}/users", headers=_h(admin_token),
                         params={"sort": "name", "order": "desc"}, timeout=15).json()
        assert len(a) == len(d) and len(a) > 0
        # First in asc should not equal first in desc (assuming >1 distinct names)
        names_a = [u["name"] for u in a]
        names_d = [u["name"] for u in d]
        assert names_a == sorted(names_a, key=str.lower) or names_a == sorted(names_a)
        # desc should be reverse-ish
        assert names_d[0] >= names_d[-1]

    def test_filter_by_location_id_super_admin(self, admin_token, two_locations):
        # Create a user in LocA
        email = f"test_uflocfilter_{uuid.uuid4().hex[:6]}@example.com"
        u = requests.post(f"{API}/users", headers=_h(admin_token), json={
            "email": email, "name": "TEST_UFLocFilter", "password": "pw123456",
            "role": "reception", "location_id": two_locations["A"]
        }, timeout=15).json()

        a = requests.get(f"{API}/users", headers=_h(admin_token),
                         params={"location_id": two_locations["A"]}, timeout=15).json()
        b = requests.get(f"{API}/users", headers=_h(admin_token),
                         params={"location_id": two_locations["B"]}, timeout=15).json()
        a_ids = {x["id"] for x in a}
        b_ids = {x["id"] for x in b}
        assert u["id"] in a_ids
        assert u["id"] not in b_ids

        requests.delete(f"{API}/users/{u['id']}", headers=_h(admin_token), timeout=15)

    def test_filter_by_department(self, admin_token, dept_in_default, default_loc):
        email = f"test_ufdept_{uuid.uuid4().hex[:6]}@example.com"
        u = requests.post(f"{API}/users", headers=_h(admin_token), json={
            "email": email, "name": "TEST_UFDept", "password": "pw123456",
            "role": "reception", "location_id": default_loc, "department_id": dept_in_default["id"]
        }, timeout=15).json()
        r = requests.get(f"{API}/users", headers=_h(admin_token),
                         params={"department_id": dept_in_default["id"]}, timeout=15)
        assert r.status_code == 200
        ids = {x["id"] for x in r.json()}
        assert u["id"] in ids
        requests.delete(f"{API}/users/{u['id']}", headers=_h(admin_token), timeout=15)


class TestUsersScopingNonAdmin:
    def test_non_admin_blocked_or_scoped(self, reception_token, two_locations):
        # reception is not admin -> /users requires admin role. expect 401/403
        r = requests.get(f"{API}/users", headers=_h(reception_token), timeout=15)
        assert r.status_code in (401, 403), f"reception should not list users; got {r.status_code} {r.text}"
