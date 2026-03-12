"""Backend API tests for NDX Command

Tests cover:
- Auth endpoints (register, login, me)
- Market data endpoints (quotes, candles)
- News endpoint
- Alerts CRUD
- Chat channels and messages
- Admin endpoints
"""
import pytest
import requests
import time
import uuid

class TestAuth:
    """Authentication endpoint tests"""

    def test_01_register_new_user(self, base_url, api_client):
        """Test user registration and verify user data"""
        test_email = f"TEST_user_{uuid.uuid4().hex[:8]}@ndxcommand.com"
        payload = {
            "email": test_email,
            "username": "Test User",
            "password": "testpass123"
        }
        response = api_client.post(f"{base_url}/api/auth/register", json=payload)
        assert response.status_code == 200, f"Registration failed: {response.text}"
        
        data = response.json()
        assert "token" in data, "Token missing from registration response"
        assert "user" in data, "User object missing from registration response"
        assert data["user"]["email"] == test_email
        assert data["user"]["username"] == "Test User"
        assert data["user"]["is_admin"] == False
        print(f"✓ Registration successful for {test_email}")

    def test_02_register_duplicate_email_fails(self, base_url, api_client):
        """Test duplicate email registration fails"""
        response = api_client.post(f"{base_url}/api/auth/register", json={
            "email": "admin@ndxcommand.com",
            "username": "Duplicate",
            "password": "test123"
        })
        assert response.status_code == 400
        print("✓ Duplicate email registration correctly blocked")

    def test_03_login_with_valid_credentials(self, base_url, api_client):
        """Test login with admin credentials"""
        response = api_client.post(f"{base_url}/api/auth/login", json={
            "email": "admin@ndxcommand.com",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == "admin@ndxcommand.com"
        assert data["user"]["is_admin"] == True
        print("✓ Admin login successful")

    def test_04_login_with_invalid_credentials(self, base_url, api_client):
        """Test login fails with wrong password"""
        response = api_client.post(f"{base_url}/api/auth/login", json={
            "email": "admin@ndxcommand.com",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        print("✓ Invalid credentials correctly rejected")

    def test_05_get_current_user(self, base_url, api_client, auth_headers):
        """Test /api/auth/me endpoint"""
        response = api_client.get(f"{base_url}/api/auth/me", headers=auth_headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "user" in data
        assert data["user"]["email"] == "admin@ndxcommand.com"
        print("✓ Get current user successful")

    def test_06_auth_me_without_token_fails(self, base_url, api_client):
        """Test /api/auth/me fails without token"""
        response = api_client.get(f"{base_url}/api/auth/me")
        assert response.status_code == 401
        print("✓ Unauthenticated access correctly blocked")


class TestMarketData:
    """Market data endpoint tests"""

    def test_01_get_all_quotes(self, base_url, api_client, auth_headers):
        """Test /api/market/quotes returns all tracked symbols"""
        response = api_client.get(f"{base_url}/api/market/quotes", headers=auth_headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "quotes" in data
        assert len(data["quotes"]) >= 10, "Should have at least 10 tracked symbols"
        
        # Validate quote structure
        quote = data["quotes"][0]
        required_fields = ['symbol', 'name', 'price', 'change', 'changePercent', 'volume', 'sentiment', 'sparkline']
        for field in required_fields:
            assert field in quote, f"Missing field: {field}"
        
        assert isinstance(quote['price'], (int, float))
        assert isinstance(quote['volume'], int)
        assert quote['sentiment'] in ['bullish', 'bearish', 'neutral']
        print(f"✓ Retrieved {len(data['quotes'])} quotes with valid structure")

    def test_02_get_single_quote(self, base_url, api_client, auth_headers):
        """Test /api/market/quote/{symbol} endpoint"""
        response = api_client.get(f"{base_url}/api/market/quote/NVDA", headers=auth_headers)
        assert response.status_code == 200
        
        quote = response.json()
        assert quote['symbol'] == 'NVDA'
        assert 'price' in quote
        assert 'sparkline' in quote
        assert len(quote['sparkline']) > 0
        print("✓ Single quote retrieval successful")

    def test_03_get_quote_invalid_symbol(self, base_url, api_client, auth_headers):
        """Test quote endpoint with untracked symbol returns 404"""
        response = api_client.get(f"{base_url}/api/market/quote/INVALID", headers=auth_headers)
        assert response.status_code == 404
        print("✓ Invalid symbol correctly returns 404")

    def test_04_get_candles(self, base_url, api_client, auth_headers):
        """Test /api/market/candles/{symbol} returns OHLCV data"""
        response = api_client.get(f"{base_url}/api/market/candles/NVDA?resolution=D&count=50", headers=auth_headers)
        assert response.status_code == 200
        
        data = response.json()
        assert data['s'] == 'ok'
        required_fields = ['t', 'o', 'h', 'l', 'c', 'v']
        for field in required_fields:
            assert field in data, f"Missing OHLCV field: {field}"
            assert len(data[field]) > 0, f"Empty {field} array"
        
        # Validate all arrays same length
        lengths = [len(data[f]) for f in required_fields]
        assert len(set(lengths)) == 1, "OHLCV arrays have mismatched lengths"
        print(f"✓ Candles data valid with {len(data['t'])} bars")

    def test_05_quotes_require_auth(self, base_url, api_client):
        """Test market endpoints require authentication"""
        response = api_client.get(f"{base_url}/api/market/quotes")
        assert response.status_code == 401
        print("✓ Market data correctly requires authentication")


class TestNews:
    """News endpoint tests"""

    def test_01_get_news_articles(self, base_url, api_client, auth_headers):
        """Test /api/news returns articles with sentiment"""
        response = api_client.get(f"{base_url}/api/news", headers=auth_headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "articles" in data
        assert len(data["articles"]) > 0, "Should have news articles"
        
        article = data["articles"][0]
        required_fields = ['id', 'headline', 'source', 'summary', 'sentiment', 'category', 'timestamp']
        for field in required_fields:
            assert field in article, f"Missing field: {field}"
        
        assert article['sentiment'] in ['bullish', 'bearish', 'neutral']
        print(f"✓ Retrieved {len(data['articles'])} news articles")


class TestAlerts:
    """Alert endpoint tests"""

    def test_01_get_alerts(self, base_url, api_client, auth_headers):
        """Test /api/alerts returns alert feed"""
        response = api_client.get(f"{base_url}/api/alerts", headers=auth_headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "alerts" in data
        assert len(data["alerts"]) >= 5, "Should have seeded alerts"
        
        alert = data["alerts"][0]
        required_fields = ['id', 'title', 'message', 'type', 'severity', 'created_by', 'created_at']
        for field in required_fields:
            assert field in alert, f"Missing field: {field}"
        print(f"✓ Retrieved {len(data['alerts'])} alerts")

    def test_02_create_alert_as_admin(self, base_url, api_client, auth_headers):
        """Test admin can create alerts"""
        alert_payload = {
            "title": "TEST_ALERT_API",
            "message": "Test alert from pytest",
            "type": "info",
            "ticker": "NVDA",
            "severity": "high"
        }
        response = api_client.post(f"{base_url}/api/alerts", json=alert_payload, headers=auth_headers)
        assert response.status_code == 200, f"Alert creation failed: {response.text}"
        
        alert = response.json()
        assert alert['title'] == alert_payload['title']
        assert alert['message'] == alert_payload['message']
        assert 'id' in alert
        
        # Verify alert appears in feed
        get_response = api_client.get(f"{base_url}/api/alerts", headers=auth_headers)
        alerts = get_response.json()['alerts']
        created_alert = next((a for a in alerts if a['title'] == 'TEST_ALERT_API'), None)
        assert created_alert is not None, "Created alert not found in feed"
        print("✓ Alert creation and retrieval successful")

    def test_03_webhook_alert(self, base_url, api_client):
        """Test webhook alert creation (no auth required)"""
        webhook_payload = {
            "title": "Webhook Test Alert",
            "message": "Test from webhook",
            "type": "bullish",
            "ticker": "QQQ"
        }
        response = api_client.post(f"{base_url}/api/alerts/webhook", json=webhook_payload)
        assert response.status_code == 200
        assert 'alert_id' in response.json()
        print("✓ Webhook alert creation successful")


class TestChat:
    """Chat endpoint tests"""

    def test_01_get_channels(self, base_url, api_client, auth_headers):
        """Test /api/chat/channels returns seeded channels"""
        response = api_client.get(f"{base_url}/api/chat/channels", headers=auth_headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "channels" in data
        assert len(data["channels"]) >= 5, "Should have at least 5 seeded channels"
        
        channel = data["channels"][0]
        assert 'id' in channel
        assert 'slug' in channel
        assert 'name' in channel
        print(f"✓ Retrieved {len(data['channels'])} channels")

    def test_02_send_and_retrieve_message(self, base_url, api_client, auth_headers):
        """Test sending message to channel and retrieving it"""
        # Get channels first
        channels_response = api_client.get(f"{base_url}/api/chat/channels", headers=auth_headers)
        channels = channels_response.json()['channels']
        channel_id = channels[0]['id']
        
        # Send message
        message_payload = {"content": "TEST_MESSAGE from pytest"}
        send_response = api_client.post(f"{base_url}/api/chat/messages/{channel_id}", json=message_payload, headers=auth_headers)
        assert send_response.status_code == 200
        
        sent_message = send_response.json()
        assert sent_message['content'] == message_payload['content']
        assert 'id' in sent_message
        assert 'username' in sent_message
        
        # Retrieve messages
        get_response = api_client.get(f"{base_url}/api/chat/messages/{channel_id}", headers=auth_headers)
        assert get_response.status_code == 200
        
        messages = get_response.json()['messages']
        created_msg = next((m for m in messages if m['content'] == 'TEST_MESSAGE from pytest'), None)
        assert created_msg is not None, "Sent message not found in channel"
        print("✓ Message send and retrieval successful")


class TestAdmin:
    """Admin endpoint tests"""

    def test_01_get_admin_stats(self, base_url, api_client, auth_headers):
        """Test /api/admin/stats endpoint"""
        response = api_client.get(f"{base_url}/api/admin/stats", headers=auth_headers)
        assert response.status_code == 200
        
        stats = response.json()
        assert 'users' in stats
        assert 'alerts' in stats
        assert 'messages' in stats
        assert stats['users'] > 0, "Should have at least admin user"
        print(f"✓ Admin stats: {stats['users']} users, {stats['alerts']} alerts, {stats['messages']} messages")

    def test_02_get_all_users(self, base_url, api_client, auth_headers):
        """Test /api/admin/users endpoint"""
        response = api_client.get(f"{base_url}/api/admin/users", headers=auth_headers)
        assert response.status_code == 200
        
        data = response.json()
        assert "users" in data
        assert len(data["users"]) > 0
        
        user = data["users"][0]
        assert 'id' in user
        assert 'email' in user
        assert 'password_hash' not in user, "Password hash should not be exposed"
        print(f"✓ Retrieved {len(data['users'])} users")

    def test_03_admin_broadcast_alert(self, base_url, api_client, auth_headers):
        """Test admin broadcast alert creation"""
        broadcast_payload = {
            "title": "TEST_BROADCAST",
            "message": "Broadcast test from pytest",
            "type": "info",
            "ticker": ""
        }
        response = api_client.post(f"{base_url}/api/admin/broadcast", json=broadcast_payload, headers=auth_headers)
        assert response.status_code == 200
        
        alert = response.json()
        assert alert['title'] == broadcast_payload['title']
        assert alert.get('is_broadcast') == True
        print("✓ Broadcast alert creation successful")

    def test_04_admin_endpoints_require_admin_role(self, base_url, api_client):
        """Test admin endpoints reject non-admin users"""
        # Register a regular user
        test_email = f"TEST_regular_{uuid.uuid4().hex[:8]}@ndxcommand.com"
        register_resp = api_client.post(f"{base_url}/api/auth/register", json={
            "email": test_email,
            "username": "Regular User",
            "password": "test123"
        })
        regular_token = register_resp.json()['token']
        regular_headers = {"Authorization": f"Bearer {regular_token}"}
        
        # Try to access admin endpoint
        response = api_client.get(f"{base_url}/api/admin/stats", headers=regular_headers)
        assert response.status_code == 403, "Admin endpoint should reject non-admin users"
        print("✓ Admin endpoints correctly require admin role")
