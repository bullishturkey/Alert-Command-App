"""
Auth bug fix regression tests — iteration 4
Covers the fix where:
  (1) getApiUrl()/getBaseUrl() no longer reads stale SERVER_URL_KEY from AsyncStorage
  (2) loadToken() only wipes JWT on 401/403 (not on network errors)
  (3) login/register/deleteAccount always use DEFAULT_API_URL

Tests:
  - POST /api/auth/login  (admin credentials, wrong password)
  - GET  /api/auth/me     (valid token → 200; invalid/expired token → 401)
  - POST /api/auth/register + login with new regular user
  - Regression: POST /api/alerts/webhook still works
  - Regression: GET  /api/ai/sentiment still works
"""
import pytest
import requests
import os
import uuid
import time

# -------------------------------------------------------
# Base URL — from env, never hardcoded
# -------------------------------------------------------
_raw = (
    os.environ.get('EXPO_PUBLIC_BACKEND_URL') or
    os.environ.get('EXPO_BACKEND_URL') or
    ''
)
assert _raw, "EXPO_PUBLIC_BACKEND_URL not set"
BASE_URL = _raw.rstrip('/')

ADMIN_EMAIL    = "gregrussell90@gmail.com"
ADMIN_PASSWORD = "Liltony2026"
WEBHOOK_SECRET = "hbd30zqEwACjWgnBbq0V4TYLzl7Da9m2b3BWcRNms8WSl7ntX27LEQo7IdduXgwV"


# -------------------------------------------------------
# Shared fixtures
# -------------------------------------------------------
@pytest.fixture(scope="module")
def admin_token():
    """Obtain and cache admin token for the module."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
    }, timeout=20)
    assert resp.status_code == 200, f"Admin login failed: {resp.status_code} {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def regular_user():
    """Register a fresh TEST_ user and return (email, password, token)."""
    email    = f"TEST_authbug_{uuid.uuid4().hex[:8]}@test.com"
    password = "Testpass123!"
    resp = requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": email,
        "username": f"testuser_{uuid.uuid4().hex[:6]}",
        "password": password,
    }, timeout=20)
    assert resp.status_code == 200, f"Register failed: {resp.status_code} {resp.text}"
    data = resp.json()
    assert "token" in data, "Token missing from register response"
    return {"email": email, "password": password, "token": data["token"]}


# -------------------------------------------------------
# 1. Login endpoint
# -------------------------------------------------------
class TestLogin:
    """POST /api/auth/login"""

    def test_admin_login_returns_200_with_token(self):
        """Correct admin credentials → 200 with {token, user}"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD,
        }, timeout=20)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "token" in data, f"'token' missing from response. Keys: {list(data.keys())}"
        assert "user"  in data, f"'user' missing from response. Keys: {list(data.keys())}"
        assert data["user"]["is_admin"] is True, "Admin flag not set on admin account"
        assert data["user"]["email"] == ADMIN_EMAIL, "Email mismatch in user object"
        # token must be a non-empty string
        assert isinstance(data["token"], str) and len(data["token"]) > 20, "Token looks invalid"
        print(f"✓ Admin login → 200, is_admin={data['user']['is_admin']}, token present")

    def test_wrong_password_returns_401(self):
        """Wrong password → 401 with detail message"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": "ThisIsWrong!",
        }, timeout=20)
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "detail" in data, "No 'detail' key in 401 response"
        print(f"✓ Wrong password → 401, detail='{data['detail']}'")

    def test_wrong_email_returns_401(self):
        """Non-existent email → 401"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "nobody@doesnotexist.com",
            "password": "irrelevant",
        }, timeout=20)
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"
        print("✓ Non-existent email → 401")

    def test_missing_fields_returns_4xx(self):
        """Empty body → 422"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={}, timeout=20)
        assert resp.status_code in (400, 422), \
            f"Expected 400 or 422 for missing fields, got {resp.status_code}: {resp.text}"
        print(f"✓ Missing fields → {resp.status_code}")


# -------------------------------------------------------
# 2. GET /api/auth/me
# -------------------------------------------------------
class TestGetMe:
    """GET /api/auth/me"""

    def test_valid_token_returns_200_with_user(self, admin_headers):
        """Valid token → 200 with {user} object"""
        resp = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=20)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "user" in data, f"'user' missing from /me response. Keys: {list(data.keys())}"
        user = data["user"]
        assert user.get("email") == ADMIN_EMAIL, \
            f"Email mismatch: expected {ADMIN_EMAIL}, got {user.get('email')}"
        assert "id"         in user, "'id' missing from user object"
        assert "username"   in user, "'username' missing from user object"
        assert "is_admin"   in user, "'is_admin' missing from user object"
        assert "created_at" in user, "'created_at' missing from user object"
        # _id (MongoDB ObjectID) must NOT leak
        assert "_id" not in user, "MongoDB _id leaked into /me response"
        print(f"✓ GET /auth/me → 200, user.email={user['email']}, is_admin={user['is_admin']}")

    def test_invalid_token_returns_401_not_500(self):
        """Bogus token → 401 (not 500 — critical regression check)"""
        resp = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer this.is.notvalid"},
            timeout=20,
        )
        assert resp.status_code == 401, \
            f"Expected 401 for invalid token, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "detail" in data, "No 'detail' in 401 error response"
        print(f"✓ Invalid token → 401, detail='{data['detail']}'")

    def test_expired_token_returns_401(self):
        """Manually crafted expired token → 401"""
        import jwt as pyjwt
        from datetime import datetime, timezone, timedelta
        # We don't know the secret but we can craft a well-formed token with
        # a known-wrong secret; server should reject with 401
        expired_token = pyjwt.encode(
            {"sub": "some-user-id", "is_admin": False,
             "exp": datetime.now(timezone.utc) - timedelta(days=1)},
            "wrong_secret",
            algorithm="HS256",
        )
        resp = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {expired_token}"},
            timeout=20,
        )
        assert resp.status_code == 401, \
            f"Expected 401 for expired/bad token, got {resp.status_code}: {resp.text}"
        print(f"✓ Expired/bad-secret token → 401")

    def test_no_auth_header_returns_401(self):
        """No Authorization header → 401"""
        resp = requests.get(f"{BASE_URL}/api/auth/me", timeout=20)
        assert resp.status_code == 401, \
            f"Expected 401 with no auth header, got {resp.status_code}: {resp.text}"
        print("✓ No auth header → 401")


# -------------------------------------------------------
# 3. Register + login regular user
# -------------------------------------------------------
class TestRegularUserFlow:
    """Register a new user, then login with those credentials"""

    def test_register_returns_200_with_token(self, regular_user):
        """Register new user → 200 with token, is_admin=False"""
        assert regular_user["token"], "Token should be non-empty after register"
        # Decode to check claims quickly (no signature verification needed)
        import base64, json
        parts = regular_user["token"].split(".")
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
        assert "sub" in claims, "JWT missing 'sub' claim"
        assert claims.get("is_admin") is False, "Regular user should not be admin"
        print(f"✓ Register → token issued for new user (is_admin=False)")

    def test_login_regular_user_returns_200(self, regular_user):
        """Login with newly registered user's credentials → 200 with token"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email":    regular_user["email"],
            "password": regular_user["password"],
        }, timeout=20)
        assert resp.status_code == 200, \
            f"Login for regular user failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert "token" in data, "Token missing from regular user login"
        assert data["user"]["is_admin"] is False, "Regular user should not be admin"
        assert data["user"]["email"] == regular_user["email"], "Email mismatch"
        print(f"✓ Regular user login → 200, is_admin=False")

    def test_regular_user_me_returns_200(self, regular_user):
        """GET /auth/me with regular user token → 200"""
        resp = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {regular_user['token']}"},
            timeout=20,
        )
        assert resp.status_code == 200, \
            f"GET /me for regular user failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert data["user"]["email"] == regular_user["email"], \
            f"Email mismatch in /me. Expected {regular_user['email']}, got {data['user']['email']}"
        print(f"✓ Regular user GET /auth/me → 200, email matches")


# -------------------------------------------------------
# 4. Regression — webhook endpoint
# -------------------------------------------------------
class TestWebhookRegression:
    """POST /api/alerts/webhook — must still work after auth changes"""

    def test_webhook_accepts_valid_secret(self):
        """Webhook with correct X-Webhook-Secret → 200"""
        content = f"WINNER NDX regression test {uuid.uuid4().hex[:6]}"
        resp = requests.post(
            f"{BASE_URL}/api/alerts/webhook",
            json={"content": content},
            headers={"X-Webhook-Secret": WEBHOOK_SECRET, "Content-Type": "application/json"},
            timeout=20,
        )
        assert resp.status_code == 200, \
            f"Webhook failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert "alert_id" in data, f"'alert_id' missing from webhook response: {data}"
        print(f"✓ Webhook regression → 200, alert_id={data['alert_id']}")

    def test_webhook_rejects_missing_secret(self):
        """Webhook without secret → 403"""
        resp = requests.post(
            f"{BASE_URL}/api/alerts/webhook",
            json={"content": "WINNER test"},
            headers={"Content-Type": "application/json"},
            timeout=20,
        )
        assert resp.status_code == 403, \
            f"Expected 403 without secret, got {resp.status_code}: {resp.text}"
        print("✓ Webhook without secret → 403 regression confirmed")


# -------------------------------------------------------
# 5. Regression — AI sentiment endpoint
# -------------------------------------------------------
class TestSentimentRegression:
    """GET /api/ai/sentiment — must still work after auth changes"""

    def test_ai_sentiment_valid_token_returns_200(self, admin_headers):
        """GET /api/ai/sentiment with valid token → 200"""
        resp = requests.get(
            f"{BASE_URL}/api/ai/sentiment",
            headers=admin_headers,
            timeout=30,
        )
        assert resp.status_code == 200, \
            f"AI sentiment failed: {resp.status_code} {resp.text}"
        data = resp.json()
        # Basic shape check
        assert "mode" in data, f"'mode' field missing from /ai/sentiment. Keys: {list(data.keys())}"
        valid_modes = ["live", "weekly_recap", "daily_recap"]
        assert data["mode"] in valid_modes, \
            f"Unexpected mode '{data['mode']}', expected one of {valid_modes}"
        print(f"✓ GET /api/ai/sentiment → 200, mode='{data['mode']}'")

    def test_ai_sentiment_requires_auth(self):
        """GET /api/ai/sentiment without auth → 401"""
        resp = requests.get(f"{BASE_URL}/api/ai/sentiment", timeout=20)
        assert resp.status_code == 401, \
            f"Expected 401 without auth, got {resp.status_code}: {resp.text}"
        print("✓ /api/ai/sentiment without auth → 401 regression confirmed")
