"""Custom roles endpoint regression tests."""
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
def admin_token():
    return _login("admin@workplace.com", "admin123")


def test_list_roles_includes_builtins(admin_token):
    r = requests.get(f"{API}/roles", headers=_h(admin_token), timeout=15)
    assert r.status_code == 200
    roles = r.json()
    values = {x["value"] for x in roles}
    assert {"super_admin", "admin", "reception", "cafeteria", "it_support", "facilities", "security"}.issubset(values)
    # All built-ins must be flagged
    for r in roles:
        if r["value"] in {"super_admin", "admin", "reception"}:
            assert r["builtin"] is True


def test_create_custom_role_then_assign_to_user(admin_token):
    suffix = uuid.uuid4().hex[:6]
    label = f"Floor Manager {suffix}"
    r = requests.post(f"{API}/roles", headers=_h(admin_token), json={"label": label}, timeout=15)
    assert r.status_code == 200, r.text
    created = r.json()
    assert created["builtin"] is False
    role_value = created["value"]

    # The new role should appear in GET /roles
    r = requests.get(f"{API}/roles", headers=_h(admin_token), timeout=15)
    values = {x["value"] for x in r.json()}
    assert role_value in values

    # Should be assignable to a new user
    locs = requests.get(f"{API}/locations", headers=_h(admin_token), timeout=15).json()
    default = next(l for l in locs if l.get("is_default"))
    email = f"floor-mgr-{suffix}@example.com"
    r = requests.post(
        f"{API}/users",
        headers=_h(admin_token),
        json={
            "name": "Floor Mgr",
            "email": email,
            "password": "test123",
            "role": role_value,
            "location_id": default["id"],
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    user = r.json()
    assert user["role"] == role_value

    # Cleanup
    requests.delete(f"{API}/users/{user['id']}", headers=_h(admin_token), timeout=10)


def test_create_role_rejects_builtin_duplicate(admin_token):
    r = requests.post(f"{API}/roles", headers=_h(admin_token), json={"label": "Admin"}, timeout=15)
    # "Admin" slugifies to "admin" which is built-in → must reject
    assert r.status_code == 400


def test_create_role_rejects_duplicate_custom(admin_token):
    label = f"Duplicate {uuid.uuid4().hex[:6]}"
    r1 = requests.post(f"{API}/roles", headers=_h(admin_token), json={"label": label}, timeout=15)
    assert r1.status_code == 200
    r2 = requests.post(f"{API}/roles", headers=_h(admin_token), json={"label": label}, timeout=15)
    assert r2.status_code == 400


def test_unknown_role_rejected_on_user_create(admin_token):
    locs = requests.get(f"{API}/locations", headers=_h(admin_token), timeout=15).json()
    default = next(l for l in locs if l.get("is_default"))
    r = requests.post(
        f"{API}/users",
        headers=_h(admin_token),
        json={
            "name": "Bogus",
            "email": f"bogus-{uuid.uuid4().hex[:6]}@example.com",
            "password": "x",
            "role": "definitely_not_a_role",
            "location_id": default["id"],
        },
        timeout=15,
    )
    assert r.status_code == 400
