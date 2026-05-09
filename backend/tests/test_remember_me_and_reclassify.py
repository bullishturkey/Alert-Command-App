"""
Tests for:
 - POST /api/auth/login with remember_me=false  → 7-day token (~604800s)
 - POST /api/auth/login with remember_me=true   → 90-day token (~7776000s)
 - POST /api/admin/reclassify-by-ndx-close      → still works (uses refactored helper)
"""
import pytest
import requests
import os
import base64
import json
import time

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/')

ADMIN_EMAIL = "gregrussell90@gmail.com"
ADMIN_PASSWORD = "Liltony2026"

SEVEN_DAYS_SECS = 7 * 24 * 3600     # 604800
NINETY_DAYS_SECS = 90 * 24 * 3600   # 7776000
TOLERANCE_SECS = 3600                # allow 1 hour slack


def decode_jwt_payload(token: str) -> dict:
    """Decode JWT payload without verifying signature."""
    parts = token.split('.')
    assert len(parts) == 3, f"Token doesn't look like a JWT: {token[:80]}"
    # Add padding
    payload_b64 = parts[1] + '=='
    payload_bytes = base64.urlsafe_b64decode(payload_b64)
    return json.loads(payload_bytes)


@pytest.fixture(scope="module")
def admin_token():
    """Login as admin (no remember_me - default) and return token."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
        "remember_me": False
    })
    assert resp.status_code == 200, f"Admin login failed: {resp.text}"
    return resp.json()["token"]


class TestRememberMeTokenExpiry:
    """Verify that login remember_me flag controls token lifespan."""

    def test_no_remember_me_returns_7day_token(self):
        """remember_me=false should issue token expiring in ~7 days."""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD,
            "remember_me": False
        })
        assert resp.status_code == 200, f"Login failed: {resp.text}"
        data = resp.json()
        assert "token" in data, "Response missing 'token'"
        payload = decode_jwt_payload(data["token"])
        assert "exp" in payload and "iat" in payload or "exp" in payload, "Token missing exp"

        # Calculate lifespan from iat and exp
        iat = payload.get("iat") or int(time.time())
        exp = payload["exp"]
        lifespan = exp - iat

        # Should be ~7 days ± 1h
        lower = SEVEN_DAYS_SECS - TOLERANCE_SECS
        upper = SEVEN_DAYS_SECS + TOLERANCE_SECS
        assert lower <= lifespan <= upper, (
            f"Expected ~7-day token ({lower}-{upper}s), got lifespan={lifespan}s "
            f"(exp={exp}, iat={iat})"
        )
        print(f"PASS: 7-day token lifespan={lifespan}s (expected ~{SEVEN_DAYS_SECS}s)")

    def test_remember_me_true_returns_90day_token(self):
        """remember_me=true should issue token expiring in ~90 days."""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD,
            "remember_me": True
        })
        assert resp.status_code == 200, f"Login failed: {resp.text}"
        data = resp.json()
        assert "token" in data, "Response missing 'token'"
        payload = decode_jwt_payload(data["token"])
        assert "exp" in payload, "Token missing exp"

        iat = payload.get("iat") or int(time.time())
        exp = payload["exp"]
        lifespan = exp - iat

        # Should be ~90 days ± 1h
        lower = NINETY_DAYS_SECS - TOLERANCE_SECS
        upper = NINETY_DAYS_SECS + TOLERANCE_SECS
        assert lower <= lifespan <= upper, (
            f"Expected ~90-day token ({lower}-{upper}s), got lifespan={lifespan}s "
            f"(exp={exp}, iat={iat})"
        )
        print(f"PASS: 90-day token lifespan={lifespan}s (expected ~{NINETY_DAYS_SECS}s)")

    def test_remember_me_default_is_false(self):
        """Omitting remember_me should behave like remember_me=false (7-day token)."""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
            # no remember_me key — defaults to False
        })
        assert resp.status_code == 200, f"Login failed: {resp.text}"
        data = resp.json()
        payload = decode_jwt_payload(data["token"])
        iat = payload.get("iat") or int(time.time())
        exp = payload["exp"]
        lifespan = exp - iat

        # Must be 7-day, NOT 90-day
        lower_7d = SEVEN_DAYS_SECS - TOLERANCE_SECS
        upper_7d = SEVEN_DAYS_SECS + TOLERANCE_SECS
        assert lower_7d <= lifespan <= upper_7d, (
            f"Default should be 7-day token, got lifespan={lifespan}s"
        )
        print(f"PASS: default remember_me=False → 7-day lifespan={lifespan}s")

    def test_remember_me_7day_less_than_90day(self):
        """Sanity: 7-day token must expire significantly earlier than 90-day token."""
        resp7 = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "remember_me": False
        })
        resp90 = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "remember_me": True
        })
        assert resp7.status_code == 200 and resp90.status_code == 200

        p7 = decode_jwt_payload(resp7.json()["token"])
        p90 = decode_jwt_payload(resp90.json()["token"])

        diff = p90["exp"] - p7["exp"]
        # 90-day exp should be ~83 days later than 7-day exp
        expected_diff = (NINETY_DAYS_SECS - SEVEN_DAYS_SECS)
        assert abs(diff - expected_diff) < TOLERANCE_SECS, (
            f"Expiry difference {diff}s expected ~{expected_diff}s"
        )
        print(f"PASS: exp diff={diff}s (expected ~{expected_diff}s)")


class TestAdminReclassifyByNdxClose:
    """Verify admin NDX-close reclassify endpoint still works after refactoring."""

    def test_reclassify_requires_auth(self):
        """Endpoint must reject unauthenticated requests with 401/403."""
        resp = requests.post(f"{BASE_URL}/api/admin/reclassify-by-ndx-close")
        assert resp.status_code in (401, 403), (
            f"Expected 401/403 without auth, got {resp.status_code}"
        )
        print(f"PASS: unauthenticated → {resp.status_code}")

    def test_reclassify_with_admin_token_succeeds(self, admin_token):
        """Admin POST /api/admin/reclassify-by-ndx-close returns 200 with result data."""
        resp = requests.post(
            f"{BASE_URL}/api/admin/reclassify-by-ndx-close",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert resp.status_code == 200, (
            f"Reclassify failed: {resp.status_code} — {resp.text[:300]}"
        )
        data = resp.json()
        # The endpoint should return some info about updated alerts
        assert isinstance(data, dict), f"Expected dict response, got {type(data)}"
        print(f"PASS: reclassify-by-ndx-close returned 200, keys={list(data.keys())}")

    def test_reclassify_response_has_message_or_counts(self, admin_token):
        """Response should contain useful fields (message, updated, total, etc.)."""
        resp = requests.post(
            f"{BASE_URL}/api/admin/reclassify-by-ndx-close",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert resp.status_code == 200
        data = resp.json()
        # Must have at least one useful field
        useful_keys = {'message', 'updated', 'total', 'skipped', 'status', 'classified', 'count'}
        found = [k for k in data.keys() if k in useful_keys]
        assert len(found) > 0, f"Response has no useful keys, got: {list(data.keys())}"
        print(f"PASS: response has useful fields: {found} → values: {[data[k] for k in found]}")

    def test_regular_user_cannot_reclassify(self):
        """Non-admin user must get 403 when calling reclassify endpoint."""
        # Register a temp user and use their token
        import uuid
        temp_email = f"TEST_reclassify_{uuid.uuid4().hex[:8]}@example.com"
        reg_resp = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": temp_email,
            "username": f"TEST_recl_{uuid.uuid4().hex[:6]}",
            "password": "TestPass123!"
        })
        if reg_resp.status_code != 200:
            pytest.skip("Could not register test user for non-admin test")
        user_token = reg_resp.json()["token"]

        resp = requests.post(
            f"{BASE_URL}/api/admin/reclassify-by-ndx-close",
            headers={"Authorization": f"Bearer {user_token}"}
        )
        assert resp.status_code == 403, (
            f"Expected 403 for non-admin, got {resp.status_code}: {resp.text[:200]}"
        )
        print(f"PASS: non-admin user → 403")
