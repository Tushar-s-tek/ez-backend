"""Socket cross-location isolation regression test.

Validates the iteration-9 fix: a super_admin who picks a SPECIFIC location must
no longer also be subscribed to SUPER_ROOM — otherwise events from every other
location would leak in via SUPER_ROOM.

The frontend only joins SUPER_ROOM when activeLocationId is null ("All
locations"). This test verifies the backend join_location handler honours the
super=false flag even when the connecting client is a super_admin.
"""
import os
import time
import threading
import pytest
import socketio
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


@pytest.fixture(scope="module")
def locations(admin_token):
    r = requests.get(f"{API}/locations", headers=_h(admin_token), timeout=15)
    locs = {loc["name"]: loc["id"] for loc in r.json()}
    # We need a "default" + at least one other location for cross-location proof.
    default = next((loc["id"] for loc in r.json() if loc.get("is_default")), None)
    others = [loc["id"] for loc in r.json() if loc["id"] != default]
    assert default and others, "need >=2 locations"
    return {"default": default, "other": others[0]}


def _connect_socket():
    """Connect a python-socketio client to the backend's /api/socket.io path."""
    sio = socketio.Client(reconnection=False)
    sio.connect(BASE_URL, socketio_path="/api/socket.io", transports=["websocket"], wait_timeout=10)
    return sio


def test_super_admin_specific_location_does_not_get_other_location_events(locations, admin_token):
    """When super_admin picks a SPECIFIC location, events from another location
    must NOT be received. This is the core bug the user reported."""
    captured_request_new = []

    # Connect socket as a "super_admin viewing 'default' location"
    # Frontend would emit: { location_id: <default>, super: False } (since they
    # picked a specific location).
    client = _connect_socket()

    @client.on("request:new")
    def on_new(data):
        captured_request_new.append(data)

    client.emit("join_location", {"location_id": locations["default"], "super": False})
    time.sleep(0.5)

    # Now, as a different actor, create a request in the OTHER location.
    # Need a room + category + PIN in the other location.
    rooms = requests.get(
        f"{API}/rooms",
        headers=_h(admin_token),
        params={"location_id": locations["other"]},
        timeout=15,
    ).json()
    if not rooms:
        client.disconnect()
        pytest.skip("no rooms in 'other' location to create a request")
    room = rooms[0]
    cats = requests.get(
        f"{API}/categories",
        headers=_h(admin_token),
        params={"location_id": locations["other"]},
        timeout=15,
    ).json()
    if not cats:
        client.disconnect()
        pytest.skip("no categories in 'other' location")
    cat = cats[0]

    # Kiosk creates a request in 'other' location.
    payload = {"room_id": room["id"], "category_id": cat["id"], "pin": room["pin"], "note": "TEST_iso"}
    r = requests.post(f"{API}/requests", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    other_req_id = r.json()["id"]

    # Wait briefly for any potential leaked event.
    time.sleep(1.5)
    client.disconnect()

    # The client (joined to default location only, NOT SUPER_ROOM) MUST NOT have
    # received the event from the other location.
    leaked = [e for e in captured_request_new if e.get("id") == other_req_id]
    assert not leaked, (
        f"CROSS-LOCATION BLEED: client joined to {locations['default']} received "
        f"{len(leaked)} event(s) from {locations['other']}: {leaked}"
    )

    # Cleanup
    requests.patch(
        f"{API}/requests/{other_req_id}/status",
        headers=_h(admin_token),
        json={"status": "closed", "note": "TEST_cleanup"},
        timeout=15,
    )


def test_super_admin_all_locations_does_receive_events(locations, admin_token):
    """Sanity check: a super_admin who joins with super=True (i.e., 'All locations'
    mode) MUST still receive events from every location via SUPER_ROOM."""
    captured = []
    client = _connect_socket()

    @client.on("request:new")
    def on_new(data):
        captured.append(data)

    # All-locations mode: location_id=None + super=True
    client.emit("join_location", {"location_id": None, "super": True})
    time.sleep(0.5)

    rooms = requests.get(
        f"{API}/rooms",
        headers=_h(admin_token),
        params={"location_id": locations["other"]},
        timeout=15,
    ).json()
    if not rooms:
        client.disconnect()
        pytest.skip("no rooms in 'other' location")
    cats = requests.get(
        f"{API}/categories",
        headers=_h(admin_token),
        params={"location_id": locations["other"]},
        timeout=15,
    ).json()
    if not cats:
        client.disconnect()
        pytest.skip("no categories in 'other' location")
    room = rooms[0]
    cat = cats[0]

    r = requests.post(
        f"{API}/requests",
        json={"room_id": room["id"], "category_id": cat["id"], "pin": room["pin"], "note": "TEST_super"},
        timeout=15,
    )
    assert r.status_code == 200
    rid = r.json()["id"]
    time.sleep(1.5)
    client.disconnect()

    received = [e for e in captured if e.get("id") == rid]
    assert received, "SUPER_ROOM client did not receive cross-location event"

    requests.patch(
        f"{API}/requests/{rid}/status",
        headers=_h(admin_token),
        json={"status": "closed", "note": "TEST_cleanup"},
        timeout=15,
    )
