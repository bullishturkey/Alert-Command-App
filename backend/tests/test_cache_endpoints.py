"""
test_cache_endpoints.py
Tests for all endpoints consumed by deviceCache stale-while-revalidate pattern.
Covers:
  - POST /api/auth/login (valid + bad credentials)
  - GET  /api/market/ndx
  - GET  /api/market/quote-multi
  - GET  /api/alerts
  - GET  /api/ai/sentiment  (may return pending=true on first call)
  - GET  /api/preflight
"""

import pytest
import requests
import os

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

# ── shared session fixture ──────────────────────────────────────────────────
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(session):
    """Login with real admin credentials and return JWT token."""
    resp = session.post(f"{BASE_URL}/api/auth/login", json={
        "email": "gregrussell90@gmail.com",
        "password": "Liltony2026",
    })
    assert resp.status_code == 200, f"Admin login failed: {resp.text}"
    token = resp.json().get("token")
    assert token, "No token in login response"
    return token


@pytest.fixture(scope="module")
def auth(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ── Auth ────────────────────────────────────────────────────────────────────
class TestAuth:
    """POST /api/auth/login — success and failure paths"""

    def test_login_returns_200_and_token(self, session):
        """Valid admin credentials should return 200 with token + user."""
        resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "gregrussell90@gmail.com",
            "password": "Liltony2026",
        })
        assert resp.status_code == 200, f"Unexpected status: {resp.status_code} — {resp.text}"
        data = resp.json()
        assert "token" in data, "No 'token' key in response"
        assert "user" in data, "No 'user' key in response"
        assert data["user"]["is_admin"] is True, "Admin flag must be True"
        print(f"✓ Admin login OK — token present, is_admin=True")

    def test_bad_password_returns_401(self, session):
        """Wrong password must return 401 (not 500, not 200)."""
        resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "gregrussell90@gmail.com",
            "password": "WrongPassword999",
        })
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✓ Bad password correctly returns 401")

    def test_bad_email_returns_401(self, session):
        """Non-existent email must return 401."""
        resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "nobody@doesnotexist.com",
            "password": "anything",
        })
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✓ Unknown email correctly returns 401")


# ── NDX market data ─────────────────────────────────────────────────────────
class TestNDX:
    """GET /api/market/ndx — NDX live quote used on Dashboard tab"""

    def test_ndx_returns_200(self, session, auth):
        resp = session.get(f"{BASE_URL}/api/market/ndx", headers=auth)
        assert resp.status_code == 200, f"NDX endpoint failed: {resp.status_code} — {resp.text}"
        data = resp.json()
        # validate core quote fields
        for field in ("symbol", "price", "change", "changePercent"):
            assert field in data, f"Missing field '{field}' in NDX response"
        assert isinstance(data["price"], (int, float)), "price must be numeric"
        print(f"✓ GET /api/market/ndx OK — price={data['price']}")

    def test_ndx_no_auth_still_returns_200(self, session):
        """NDX uses get_optional_user — should work without auth too."""
        resp = session.get(f"{BASE_URL}/api/market/ndx")
        assert resp.status_code == 200, f"NDX without auth failed: {resp.status_code}"
        print("✓ GET /api/market/ndx (no auth) OK")


# ── Quote-multi ──────────────────────────────────────────────────────────────
class TestQuoteMulti:
    """GET /api/market/quote-multi — watchlist multi-quote used on Dashboard tab"""

    def test_quote_multi_with_symbols(self, session, auth):
        resp = session.get(
            f"{BASE_URL}/api/market/quote-multi",
            params={"symbols": "AAPL,NVDA"},
            headers=auth,
        )
        assert resp.status_code == 200, f"quote-multi failed: {resp.status_code} — {resp.text}"
        data = resp.json()
        assert "quotes" in data, "Missing 'quotes' key in response"
        assert isinstance(data["quotes"], list), "'quotes' must be a list"
        # at least one quote returned
        assert len(data["quotes"]) >= 1, "Expected at least 1 quote for AAPL,NVDA"
        q = data["quotes"][0]
        for field in ("symbol", "price", "change", "changePercent"):
            assert field in q, f"Quote missing field '{field}'"
        print(f"✓ GET /api/market/quote-multi OK — {len(data['quotes'])} quotes returned")

    def test_quote_multi_empty_symbols(self, session, auth):
        """Empty symbols param should return 200 with empty quotes list."""
        resp = session.get(
            f"{BASE_URL}/api/market/quote-multi",
            params={"symbols": ""},
            headers=auth,
        )
        assert resp.status_code == 200, f"quote-multi (empty) failed: {resp.status_code}"
        data = resp.json()
        assert "quotes" in data
        print(f"✓ GET /api/market/quote-multi (empty) OK — {data['quotes']} quotes")


# ── Alerts ───────────────────────────────────────────────────────────────────
class TestAlerts:
    """GET /api/alerts — alerts list used on Alerts tab (cache writes to ALERTS key)"""

    def test_alerts_returns_200(self, session, auth):
        resp = session.get(f"{BASE_URL}/api/alerts", headers=auth)
        assert resp.status_code == 200, f"Alerts failed: {resp.status_code} — {resp.text}"
        data = resp.json()
        assert "alerts" in data, "Missing 'alerts' key"
        assert isinstance(data["alerts"], list), "'alerts' must be a list"
        if len(data["alerts"]) > 0:
            alert = data["alerts"][0]
            for field in ("id", "title", "message", "type", "created_at"):
                assert field in alert, f"Alert missing field '{field}'"
        print(f"✓ GET /api/alerts OK — {len(data['alerts'])} alerts")

    def test_alerts_requires_auth(self, session):
        """Alerts endpoint must return 401 without token."""
        resp = session.get(f"{BASE_URL}/api/alerts")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✓ GET /api/alerts (no auth) correctly returns 401")


# ── AI Sentiment ─────────────────────────────────────────────────────────────
class TestAISentiment:
    """GET /api/ai/sentiment — sentiment data used on Preflight/AI tab"""

    def test_ai_sentiment_returns_200(self, session, auth):
        resp = session.get(f"{BASE_URL}/api/ai/sentiment", headers=auth)
        assert resp.status_code == 200, f"AI sentiment failed: {resp.status_code} — {resp.text}"
        data = resp.json()
        # Either pending=True (still generating) or has sentiment object
        assert "mode" in data, "Missing 'mode' field in AI sentiment response"
        pending = data.get("pending", False)
        if pending:
            print(f"✓ GET /api/ai/sentiment OK — pending=True (still generating), mode={data['mode']}")
        else:
            assert "sentiment" in data, "Non-pending response missing 'sentiment'"
            sent = data["sentiment"]
            for field in ("overall_sentiment", "confidence", "summary"):
                assert field in sent, f"Sentiment missing field '{field}'"
            print(f"✓ GET /api/ai/sentiment OK — mode={data['mode']}, sentiment={sent['overall_sentiment']}")

    def test_ai_sentiment_requires_auth(self, session):
        """Sentiment endpoint must return 401 without token."""
        resp = session.get(f"{BASE_URL}/api/ai/sentiment")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✓ GET /api/ai/sentiment (no auth) correctly returns 401")


# ── Preflight ────────────────────────────────────────────────────────────────
class TestPreflight:
    """GET /api/preflight — economic events and earnings used on Preflight tab"""

    def test_preflight_returns_200(self, session, auth):
        resp = session.get(f"{BASE_URL}/api/preflight", headers=auth)
        assert resp.status_code == 200, f"Preflight failed: {resp.status_code} — {resp.text}"
        data = resp.json()
        # top-level keys
        assert "economic_events" in data, "Missing 'economic_events'"
        assert "earnings" in data, "Missing 'earnings'"
        assert isinstance(data["economic_events"], list), "'economic_events' must be a list"
        assert isinstance(data["earnings"], list), "'earnings' must be a list"

        if data["economic_events"]:
            ev = data["economic_events"][0]
            for field in ("event", "date", "impact"):
                assert field in ev, f"Economic event missing field '{field}'"

        if data["earnings"]:
            earn = data["earnings"][0]
            for field in ("symbol", "date", "hour"):
                assert field in earn, f"Earnings missing field '{field}'"

        print(
            f"✓ GET /api/preflight OK — "
            f"{len(data['economic_events'])} events, {len(data['earnings'])} earnings"
        )

    def test_preflight_requires_auth(self, session):
        """Preflight endpoint must return 401 without token."""
        resp = session.get(f"{BASE_URL}/api/preflight")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✓ GET /api/preflight (no auth) correctly returns 401")
