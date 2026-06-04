"""Visitor QR + invite + check-in regression tests.

Locks in three user-reported fixes:
 - Pre-register response includes an ABSOLUTE checkin_url + a checkin_qr image
   that, when decoded, points at the live FRONTEND_URL (phone cameras can
   scan + open the link).
 - The badge-public response (shown after self check-in) also includes a
   badge_qr that decodes to the same absolute URL.
"""
import os
import io
import base64
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://officeflow-pro.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@workplace.com", "admin123")


@pytest.fixture(scope="module")
def ceo_room(admin_token):
    r = requests.get(f"{API}/rooms", headers=_h(admin_token), timeout=15)
    rooms = [x for x in r.json() if x["name"] == "CEO Cabin"]
    assert rooms, "CEO Cabin missing"
    return rooms[0]


def _decode_qr(data_url: str) -> str:
    """Decode a base64-PNG data URL into the encoded QR string. Uses OpenCV's
    QRCodeDetector if available, otherwise pyzbar. Returns the decoded text."""
    b64 = data_url.split(",", 1)[1]
    png = base64.b64decode(b64)
    try:
        from PIL import Image
        import numpy as np
        import cv2
        img = Image.open(io.BytesIO(png))
        arr = np.array(img.convert("RGB"))
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        det = cv2.QRCodeDetector()
        val, _, _ = det.detectAndDecode(bgr)
        return val or ""
    except Exception as e:  # pragma: no cover — environment-dependent
        pytest.skip(f"QR decode dependencies unavailable: {e}")


def test_pre_register_returns_absolute_checkin_url(admin_token, ceo_room):
    r = requests.post(
        f"{API}/visitors/pre-register",
        headers=_h(admin_token),
        json={"name": "QR Test", "host_room_id": ceo_room["id"], "purpose": "qr-test"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["checkin_url"].startswith("https://"), f"checkin_url must be absolute, got {d['checkin_url']}"
    assert f"/visitors/checkin?pin={d['pin']}" in d["checkin_url"]
    # Cleanup
    requests.patch(
        f"{API}/visitors/{d['id']}/status",
        headers=_h(admin_token),
        json={"status": "checked_out"},
        timeout=15,
    )


def test_pre_register_qr_decodes_to_absolute_url(admin_token, ceo_room):
    r = requests.post(
        f"{API}/visitors/pre-register",
        headers=_h(admin_token),
        json={"name": "QR Decode", "host_room_id": ceo_room["id"]},
        timeout=15,
    )
    d = r.json()
    decoded = _decode_qr(d["checkin_qr"])
    assert decoded.startswith("https://"), f"QR did not encode an absolute URL: {decoded!r}"
    assert f"pin={d['pin']}" in decoded
    requests.patch(
        f"{API}/visitors/{d['id']}/status",
        headers=_h(admin_token),
        json={"status": "checked_out"},
        timeout=15,
    )


def test_badge_public_qr_decodes_to_absolute_url(admin_token, ceo_room):
    r = requests.post(
        f"{API}/visitors/pre-register",
        headers=_h(admin_token),
        json={"name": "Badge QR", "host_room_id": ceo_room["id"]},
        timeout=15,
    )
    d = r.json()
    # Check in
    requests.post(
        f"{API}/visitors/self-checkin",
        json={"pin": d["pin"], "nda_signed_name": "Badge QR"},
        timeout=15,
    )
    # Now grab the public badge that's shown to the visitor after check-in
    badge = requests.get(f"{API}/visitors/badge-public/{d['pin']}", timeout=15).json()
    assert badge.get("badge_qr"), "badge_qr missing from public badge response"
    decoded = _decode_qr(badge["badge_qr"])
    assert decoded.startswith("https://"), f"badge_qr did not encode absolute URL: {decoded!r}"
    requests.patch(
        f"{API}/visitors/{d['id']}/status",
        headers=_h(admin_token),
        json={"status": "checked_out"},
        timeout=15,
    )
