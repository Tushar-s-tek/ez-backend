"""Admin user creation regression tests.

Locks in: when a non-super-admin admin creates a user via POST /api/users
without specifying a location_id, the new user is auto-assigned to the
admin's own primary location_id. Super_admin can pick any location.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://officeflow-pro.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def super_token():
    return _login("admin@workplace.com", "admin123")


@pytest.fixture(scope="module")
def locations(super_token):
    r = requests.get(f"{API}/locations", headers=_h(super_token), timeout=15)
    return r.json()


@pytest.fixture(scope="module")
def bengalore_loc(locations):
    return next(l for l in locations if l.get("is_default"))


@pytest.fixture
def bengalore_admin(super_token, bengalore_loc):
    """Create + delete a temporary admin in HQ-Bengalore for the test."""
    email = f"bengalore-admin-{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{API}/users",
        headers=_h(super_token),
        json={
            "name": "Bengalore Admin",
            "email": email,
            "password": "test123",
            "role": "admin",
            "location_id": bengalore_loc["id"],
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    uid = r.json()["id"]
    yield {"email": email, "password": "test123", "uid": uid, "location_id": bengalore_loc["id"]}
    # Cleanup
    requests.delete(f"{API}/users/{uid}", headers=_h(super_token), timeout=10)


def test_admin_creates_user_inherits_own_location(super_token, bengalore_admin):
    """Bengalore admin → POST /users (without location_id) → new user must
    be created in HQ-Bengalore."""
    admin_token = _login(bengalore_admin["email"], bengalore_admin["password"])
    new_email = f"new-staff-{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{API}/users",
        headers=_h(admin_token),
        json={
            "name": "New Reception",
            "email": new_email,
            "password": "test123",
            "role": "reception",
            "department_id": None,
            # NOTE: deliberately omitting location_id — should auto-fill
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    created = r.json()
    assert created["location_id"] == bengalore_admin["location_id"], (
        f"new user got location {created['location_id']!r}, "
        f"expected {bengalore_admin['location_id']!r}"
    )
    # Cleanup the staff user
    requests.delete(f"{API}/users/{created['id']}", headers=_h(super_token), timeout=10)


def test_admin_cannot_create_user_in_another_location(super_token, bengalore_admin, locations):
    """Even if the admin sends a different location_id, the server forces it
    to the admin's own location (no privilege escalation)."""
    other_locs = [l for l in locations if l["id"] != bengalore_admin["location_id"]]
    if not other_locs:
        pytest.skip("need >=2 locations to test cross-tenancy")
    other_loc_id = other_locs[0]["id"]

    admin_token = _login(bengalore_admin["email"], bengalore_admin["password"])
    new_email = f"cross-staff-{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{API}/users",
        headers=_h(admin_token),
        json={
            "name": "Sneaky Cross",
            "email": new_email,
            "password": "test123",
            "role": "reception",
            "location_id": other_loc_id,  # intentionally cross-tenant
        },
        timeout=15,
    )
    # Server should either reject (403) or coerce to admin's own location_id.
    # Either is acceptable — we never want a successful cross-tenant write.
    if r.status_code == 200:
        created = r.json()
        assert created["location_id"] == bengalore_admin["location_id"], (
            f"PRIVILEGE ESCALATION: bengalore-admin created user in {created['location_id']}"
        )
        requests.delete(f"{API}/users/{created['id']}", headers=_h(super_token), timeout=10)
    else:
        assert r.status_code in (400, 403)


def test_super_admin_can_create_user_in_any_location(super_token, locations):
    """Super_admin should be able to explicitly pick any location for a new user."""
    target = next(l for l in locations if not l.get("is_default"))
    new_email = f"super-cross-{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{API}/users",
        headers=_h(super_token),
        json={
            "name": "Super Cross",
            "email": new_email,
            "password": "test123",
            "role": "reception",
            "location_id": target["id"],
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    created = r.json()
    assert created["location_id"] == target["id"]
    requests.delete(f"{API}/users/{created['id']}", headers=_h(super_token), timeout=10)
