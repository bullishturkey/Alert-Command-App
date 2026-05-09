"""
Backend tests for 3 specific fixes:
1. Discord keyword color detection in webhook alerts (WINNER/LOSER/BUY/SELL → bullish/bearish)
2. Admin refresh-sentiment routes by market state and returns mode field
3. GET /ai/sentiment returns mode field
4. Login endpoint verification
"""
import pytest
import requests
import os
import uuid
import time

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/')
WEBHOOK_SECRET = "hbd30zqEwACjWgnBbq0V4TYLzl7Da9m2b3BWcRNms8WSl7ntX27LEQo7IdduXgwV"
ADMIN_EMAIL = "gregrussell90@gmail.com"
ADMIN_PASSWORD = "Liltony2026"


@pytest.fixture(scope="module")
def admin_token():
    """Login as admin and return token"""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    assert resp.status_code == 200, f"Admin login failed: {resp.text}"
    return resp.json()['token']


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json"
    }


@pytest.fixture
def webhook_headers():
    return {
        "X-Webhook-Secret": WEBHOOK_SECRET,
        "Content-Type": "application/json"
    }


# =============================================
# TEST 1: Login endpoint
# =============================================
class TestLogin:
    """Verify login endpoint still works"""

    def test_login_with_correct_admin_credentials(self):
        """POST /api/auth/login with admin credentials → 200 with token"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert resp.status_code == 200, f"Login failed: {resp.text}"
        data = resp.json()
        assert "token" in data, "Token missing from login response"
        assert "user" in data, "User object missing from login response"
        assert data["user"]["is_admin"] == True, "Admin flag not set"
        print(f"✓ Admin login successful, is_admin={data['user']['is_admin']}")

    def test_login_with_wrong_password_returns_401(self):
        """POST /api/auth/login with wrong password → 401"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": "wrongpassword"
        })
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✓ Wrong password correctly returns 401")


# =============================================
# TEST 2: Webhook keyword color detection
# =============================================
class TestWebhookKeywordDetection:
    """Verify webhook alerts auto-assign type from WINNER/LOSER/BUY/SELL keywords"""

    created_alert_ids = []

    def _post_webhook(self, content: str, headers: dict) -> dict:
        resp = requests.post(
            f"{BASE_URL}/api/alerts/webhook",
            json={"content": content},
            headers=headers
        )
        assert resp.status_code == 200, f"Webhook failed: {resp.status_code} {resp.text}"
        return resp.json()

    def _get_alert_by_id(self, alert_id: str, admin_headers: dict) -> dict:
        """Fetch all alerts and find the one with matching id"""
        resp = requests.get(f"{BASE_URL}/api/alerts", headers=admin_headers)
        assert resp.status_code == 200
        alerts = resp.json().get("alerts", [])
        for a in alerts:
            if a.get("id") == alert_id:
                return a
        return {}

    def test_winner_keyword_produces_bullish_type(self, admin_headers, webhook_headers):
        """WINNER keyword → alert type should be 'bullish'"""
        content = "WINNER NDX 19500 calls - massive move"
        result = self._post_webhook(content, webhook_headers)
        alert_id = result["alert_id"]
        self.created_alert_ids.append(alert_id)

        alert = self._get_alert_by_id(alert_id, admin_headers)
        assert alert, f"Alert {alert_id} not found in feed"
        actual_type = alert.get("type")
        assert actual_type == "bullish", (
            f"WINNER keyword should produce type='bullish', got type='{actual_type}'. "
            f"Bug: webhook endpoint hardcodes type='signal' without calling _detect_alert_type()"
        )
        print(f"✓ WINNER keyword → type='{actual_type}'")

    def test_loser_keyword_produces_bearish_type(self, admin_headers, webhook_headers):
        """LOSER keyword → alert type should be 'bearish'"""
        content = "LOSER trade - NDX breakdown confirmed"
        result = self._post_webhook(content, webhook_headers)
        alert_id = result["alert_id"]
        self.created_alert_ids.append(alert_id)

        alert = self._get_alert_by_id(alert_id, admin_headers)
        assert alert, f"Alert {alert_id} not found in feed"
        actual_type = alert.get("type")
        assert actual_type == "bearish", (
            f"LOSER keyword should produce type='bearish', got type='{actual_type}'. "
            f"Bug: webhook endpoint hardcodes type='signal' without calling _detect_alert_type()"
        )
        print(f"✓ LOSER keyword → type='{actual_type}'")

    def test_buy_keyword_produces_bullish_type(self, admin_headers, webhook_headers):
        """'BUY NDX calls 19500' → alert type should be 'bullish'"""
        content = "BUY NDX calls 19500"
        result = self._post_webhook(content, webhook_headers)
        alert_id = result["alert_id"]
        self.created_alert_ids.append(alert_id)

        alert = self._get_alert_by_id(alert_id, admin_headers)
        assert alert, f"Alert {alert_id} not found in feed"
        actual_type = alert.get("type")
        assert actual_type == "bullish", (
            f"BUY keyword should produce type='bullish', got type='{actual_type}'"
        )
        print(f"✓ BUY keyword → type='{actual_type}'")

    def test_sell_keyword_produces_bearish_type(self, admin_headers, webhook_headers):
        """SELL keyword → alert type should be 'bearish'"""
        content = "SELL NDX puts 19200"
        result = self._post_webhook(content, webhook_headers)
        alert_id = result["alert_id"]
        self.created_alert_ids.append(alert_id)

        alert = self._get_alert_by_id(alert_id, admin_headers)
        assert alert, f"Alert {alert_id} not found in feed"
        actual_type = alert.get("type")
        assert actual_type == "bearish", (
            f"SELL keyword should produce type='bearish', got type='{actual_type}'"
        )
        print(f"✓ SELL keyword → type='{actual_type}'")

    def test_webhook_without_keyword_falls_back_to_signal(self, admin_headers, webhook_headers):
        """Plain number message with no keyword should be 'signal'"""
        content = "24580.50"
        result = self._post_webhook(content, webhook_headers)
        alert_id = result["alert_id"]
        self.created_alert_ids.append(alert_id)

        alert = self._get_alert_by_id(alert_id, admin_headers)
        assert alert, f"Alert {alert_id} not found in feed"
        actual_type = alert.get("type")
        assert actual_type == "signal", (
            f"No-keyword message should produce type='signal', got type='{actual_type}'"
        )
        print(f"✓ No-keyword message → type='{actual_type}'")

    def test_webhook_forbidden_without_secret(self, webhook_headers):
        """Webhook without X-Webhook-Secret → 403"""
        resp = requests.post(
            f"{BASE_URL}/api/alerts/webhook",
            json={"content": "WINNER trade"},
            headers={"Content-Type": "application/json"}
        )
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}: {resp.text}"
        print("✓ Webhook correctly rejects requests without secret")

    def test_alerts_feed_contains_webhook_alerts(self, admin_headers, webhook_headers):
        """GET /api/alerts → should include webhook alerts"""
        # Post a webhook alert first
        content = "WINNER NDX 19500 - test for feed"
        result = self._post_webhook(content, webhook_headers)
        alert_id = result["alert_id"]
        self.created_alert_ids.append(alert_id)

        resp = requests.get(f"{BASE_URL}/api/alerts", headers=admin_headers)
        assert resp.status_code == 200
        alerts = resp.json().get("alerts", [])
        found = any(a.get("id") == alert_id for a in alerts)
        assert found, "Webhook alert not found in /api/alerts feed"
        print(f"✓ Webhook alert {alert_id} found in alerts feed")


# =============================================
# TEST 3: Admin refresh-sentiment
# =============================================
class TestAdminRefreshSentiment:
    """Verify POST /api/admin/refresh-sentiment returns status=success with mode field"""

    def test_refresh_sentiment_returns_200_with_mode(self, admin_headers):
        """POST /api/admin/refresh-sentiment → 200, status=success, mode field present"""
        resp = requests.post(
            f"{BASE_URL}/api/admin/refresh-sentiment",
            headers=admin_headers,
            timeout=60  # AI generation can take up to 30s
        )
        assert resp.status_code == 200, f"Refresh sentiment failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert data.get("status") == "success", (
            f"Expected status='success', got status='{data.get('status')}'. Response: {data}"
        )
        assert "mode" in data, f"'mode' field missing from response. Response: {data}"
        valid_modes = ['live', 'weekly_recap', 'daily_recap', 'already_refreshing']
        assert data["mode"] in valid_modes, (
            f"mode should be one of {valid_modes}, got '{data['mode']}'"
        )
        print(f"✓ Admin refresh-sentiment: status={data['status']}, mode={data['mode']}")

    def test_refresh_sentiment_requires_admin_auth(self):
        """POST /api/admin/refresh-sentiment without auth → 401"""
        resp = requests.post(f"{BASE_URL}/api/admin/refresh-sentiment")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✓ refresh-sentiment correctly requires auth")

    def test_refresh_sentiment_rejects_non_admin(self):
        """POST /api/admin/refresh-sentiment with non-admin token → 403"""
        # Register regular user
        test_email = f"TEST_nonadmin_{uuid.uuid4().hex[:6]}@test.com"
        reg_resp = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": test_email, "username": "nonadmin", "password": "test123"
        })
        if reg_resp.status_code != 200:
            pytest.skip("Could not create regular user for this test")
        regular_token = reg_resp.json()["token"]
        resp = requests.post(
            f"{BASE_URL}/api/admin/refresh-sentiment",
            headers={"Authorization": f"Bearer {regular_token}"}
        )
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"
        print("✓ refresh-sentiment correctly rejects non-admin users")


# =============================================
# TEST 4: GET /ai/sentiment
# =============================================
class TestAiSentiment:
    """Verify GET /api/ai/sentiment returns sentiment data with mode field"""

    def test_get_ai_sentiment_returns_200(self, admin_headers):
        """GET /api/ai/sentiment → 200 with sentiment data"""
        resp = requests.get(f"{BASE_URL}/api/ai/sentiment", headers=admin_headers, timeout=30)
        assert resp.status_code == 200, f"AI sentiment failed: {resp.status_code} {resp.text}"
        data = resp.json()
        print(f"✓ GET /api/ai/sentiment returned 200. Keys: {list(data.keys())}")
        return data

    def test_get_ai_sentiment_has_mode_field(self, admin_headers):
        """GET /api/ai/sentiment → response must include 'mode' field"""
        resp = requests.get(f"{BASE_URL}/api/ai/sentiment", headers=admin_headers, timeout=30)
        assert resp.status_code == 200
        data = resp.json()
        assert "mode" in data, f"'mode' field missing from /api/ai/sentiment response. Keys: {list(data.keys())}"
        valid_modes = ['live', 'weekly_recap', 'daily_recap']
        assert data["mode"] in valid_modes, (
            f"mode should be one of {valid_modes}, got '{data['mode']}'"
        )
        print(f"✓ ai/sentiment mode='{data['mode']}'")

    def test_get_ai_sentiment_has_sentiment_field(self, admin_headers):
        """GET /api/ai/sentiment → response includes 'sentiment' or 'weekly_recap'/'daily_recap' key"""
        resp = requests.get(f"{BASE_URL}/api/ai/sentiment", headers=admin_headers, timeout=30)
        assert resp.status_code == 200
        data = resp.json()
        # At least one of these should be present depending on market state
        has_sentiment_data = (
            "sentiment" in data or
            "weekly_recap" in data or
            "daily_recap" in data or
            data.get("pending") is True
        )
        assert has_sentiment_data, (
            f"No sentiment data in response. Keys: {list(data.keys())}"
        )
        print(f"✓ ai/sentiment has valid sentiment data. mode={data.get('mode')}")

    def test_get_ai_sentiment_requires_auth(self):
        """GET /api/ai/sentiment without auth → 401"""
        resp = requests.get(f"{BASE_URL}/api/ai/sentiment")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✓ ai/sentiment correctly requires auth")
