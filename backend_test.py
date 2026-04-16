#!/usr/bin/env python3
"""
NDX Command Trading Intelligence Platform - Backend API Testing
Tests all backend endpoints as specified in the review request.
"""

import requests
import json
import os
import sys
from datetime import datetime, timezone

# Get backend URL from environment
BACKEND_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://nasdaq-command.preview.emergentagent.com').rstrip('/')
API_BASE = f"{BACKEND_URL}/api"

# Test credentials from test_credentials.md
ADMIN_EMAIL = "admin@ndxcommand.com"
ADMIN_PASSWORD = "admin123"

class NDXCommandAPITester:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.admin_token = None
        self.test_results = []
        
    def log_result(self, test_name, success, message, response_data=None):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}: {message}")
        self.test_results.append({
            'test': test_name,
            'success': success,
            'message': message,
            'response_data': response_data
        })
        
    def test_auth_login(self):
        """Test 1: Auth Flow - POST /api/auth/login"""
        print("\n=== Testing Auth Flow ===")
        try:
            response = self.session.post(f"{API_BASE}/auth/login", json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            })
            
            if response.status_code == 200:
                data = response.json()
                if 'token' in data and 'user' in data:
                    self.admin_token = data['token']
                    self.session.headers.update({"Authorization": f"Bearer {self.admin_token}"})
                    self.log_result("Auth Login", True, f"Login successful, token received, user: {data['user']['email']}")
                    return True
                else:
                    self.log_result("Auth Login", False, "Response missing token or user data", data)
            else:
                self.log_result("Auth Login", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_result("Auth Login", False, f"Exception: {str(e)}")
        return False
        
    def test_market_ndx(self):
        """Test 2: Market Data - GET /api/market/ndx"""
        print("\n=== Testing NDX Market Data ===")
        try:
            response = self.session.get(f"{API_BASE}/market/ndx")
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ['symbol', 'name', 'price', 'change', 'changePercent', 'timestamp']
                missing_fields = [field for field in required_fields if field not in data]
                
                if not missing_fields:
                    self.log_result("NDX Market Data", True, 
                                  f"NDX quote received: {data['symbol']} @ ${data['price']} ({data['changePercent']:+.2f}%)")
                    return True
                else:
                    self.log_result("NDX Market Data", False, f"Missing fields: {missing_fields}", data)
            else:
                self.log_result("NDX Market Data", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_result("NDX Market Data", False, f"Exception: {str(e)}")
        return False
        
    def test_market_quotes(self):
        """Test 3: Market Quotes - GET /api/market/quotes"""
        print("\n=== Testing Market Quotes ===")
        try:
            response = self.session.get(f"{API_BASE}/market/quotes")
            
            if response.status_code == 200:
                data = response.json()
                if 'quotes' in data and len(data['quotes']) > 0:
                    quotes_count = len(data['quotes'])
                    symbols = [q['symbol'] for q in data['quotes'][:5]]  # First 5 symbols
                    self.log_result("Market Quotes", True, 
                                  f"Retrieved {quotes_count} quotes: {', '.join(symbols)}...")
                    return True
                else:
                    self.log_result("Market Quotes", False, "No quotes in response", data)
            else:
                self.log_result("Market Quotes", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_result("Market Quotes", False, f"Exception: {str(e)}")
        return False
        
    def test_preflight(self):
        """Test 4: Preflight - GET /api/preflight"""
        print("\n=== Testing Preflight Data ===")
        try:
            response = self.session.get(f"{API_BASE}/preflight")
            
            if response.status_code == 200:
                data = response.json()
                required_sections = ['economic_events', 'earnings', 'breaking_news']
                missing_sections = [section for section in required_sections if section not in data]
                
                if not missing_sections:
                    # Check for time_utc field in economic events
                    events_with_time_utc = 0
                    for event in data.get('economic_events', []):
                        if 'time_utc' in event:
                            events_with_time_utc += 1
                    
                    events_count = len(data['economic_events'])
                    earnings_count = len(data['earnings'])
                    news_count = len(data['breaking_news'])
                    
                    message = f"Preflight data: {events_count} events ({events_with_time_utc} with time_utc), {earnings_count} earnings, {news_count} news"
                    self.log_result("Preflight Data", True, message)
                    
                    # Verify time_utc format if present
                    if events_with_time_utc > 0:
                        sample_event = next(e for e in data['economic_events'] if 'time_utc' in e)
                        try:
                            datetime.fromisoformat(sample_event['time_utc'].replace('Z', '+00:00'))
                            self.log_result("Preflight Time UTC", True, f"time_utc field format valid: {sample_event['time_utc']}")
                        except ValueError:
                            self.log_result("Preflight Time UTC", False, f"Invalid time_utc format: {sample_event['time_utc']}")
                    
                    return True
                else:
                    self.log_result("Preflight Data", False, f"Missing sections: {missing_sections}", data)
            else:
                self.log_result("Preflight Data", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_result("Preflight Data", False, f"Exception: {str(e)}")
        return False
        
    def test_alerts(self):
        """Test 5: Alerts - GET /api/alerts"""
        print("\n=== Testing Alerts ===")
        try:
            response = self.session.get(f"{API_BASE}/alerts")
            
            if response.status_code == 200:
                data = response.json()
                if 'alerts' in data:
                    alerts_count = len(data['alerts'])
                    if alerts_count > 0:
                        sample_alert = data['alerts'][0]
                        required_fields = ['id', 'title', 'message', 'type', 'severity', 'created_at']
                        missing_fields = [field for field in required_fields if field not in sample_alert]
                        
                        if not missing_fields:
                            self.log_result("Alerts", True, f"Retrieved {alerts_count} alerts with valid structure")
                            return True
                        else:
                            self.log_result("Alerts", False, f"Alert missing fields: {missing_fields}", sample_alert)
                    else:
                        self.log_result("Alerts", True, "No alerts found (empty list is valid)")
                        return True
                else:
                    self.log_result("Alerts", False, "Response missing 'alerts' field", data)
            else:
                self.log_result("Alerts", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_result("Alerts", False, f"Exception: {str(e)}")
        return False
        
    def test_chat_channels(self):
        """Test 6: Chat - GET /api/chat/channels"""
        print("\n=== Testing Chat Channels ===")
        try:
            response = self.session.get(f"{API_BASE}/chat/channels")
            
            if response.status_code == 200:
                data = response.json()
                if 'channels' in data:
                    channels_count = len(data['channels'])
                    if channels_count > 0:
                        channel_names = [c.get('name', c.get('slug', 'unnamed')) for c in data['channels'][:3]]
                        self.log_result("Chat Channels", True, f"Retrieved {channels_count} channels: {', '.join(channel_names)}...")
                        return True
                    else:
                        self.log_result("Chat Channels", True, "No channels found (empty list is valid)")
                        return True
                else:
                    self.log_result("Chat Channels", False, "Response missing 'channels' field", data)
            else:
                self.log_result("Chat Channels", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_result("Chat Channels", False, f"Exception: {str(e)}")
        return False
        
    def test_webhook_alert(self):
        """Test 7: Webhook - POST /api/alerts/webhook (no auth required)"""
        print("\n=== Testing Webhook Alert ===")
        try:
            # Create a new session without auth headers for webhook test
            webhook_session = requests.Session()
            webhook_session.headers.update({"Content-Type": "application/json"})
            
            test_payload = {"content": "24,580.50"}
            response = webhook_session.post(f"{API_BASE}/alerts/webhook", json=test_payload)
            
            if response.status_code == 200:
                data = response.json()
                if 'alert_id' in data:
                    self.log_result("Webhook Alert", True, f"Webhook accepted, alert_id: {data['alert_id']}")
                    return True
                else:
                    self.log_result("Webhook Alert", False, "Response missing alert_id", data)
            else:
                self.log_result("Webhook Alert", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_result("Webhook Alert", False, f"Exception: {str(e)}")
        return False
        
    def test_auth_required_endpoints(self):
        """Test that protected endpoints require authentication"""
        print("\n=== Testing Auth Requirements ===")
        try:
            # Create session without auth
            unauth_session = requests.Session()
            unauth_session.headers.update({"Content-Type": "application/json"})
            
            protected_endpoints = [
                "/market/ndx",
                "/market/quotes", 
                "/alerts",
                "/chat/channels",
                "/preflight"
            ]
            
            auth_working = True
            for endpoint in protected_endpoints:
                response = unauth_session.get(f"{API_BASE}{endpoint}")
                if response.status_code != 401:
                    self.log_result("Auth Protection", False, f"{endpoint} should return 401 but returned {response.status_code}")
                    auth_working = False
                    
            if auth_working:
                self.log_result("Auth Protection", True, "All protected endpoints correctly require authentication")
                return True
                
        except Exception as e:
            self.log_result("Auth Protection", False, f"Exception: {str(e)}")
        return False
        
    def run_all_tests(self):
        """Run all backend API tests"""
        print(f"🚀 Starting NDX Command Backend API Tests")
        print(f"📡 Backend URL: {BACKEND_URL}")
        print(f"🔑 Testing with admin credentials: {ADMIN_EMAIL}")
        
        # Test 1: Authentication (required for other tests)
        if not self.test_auth_login():
            print("\n❌ Authentication failed - cannot proceed with protected endpoint tests")
            return False
            
        # Test 2-6: Protected endpoints
        self.test_market_ndx()
        self.test_market_quotes()
        self.test_preflight()
        self.test_alerts()
        self.test_chat_channels()
        
        # Test 7: Webhook (no auth required)
        self.test_webhook_alert()
        
        # Test 8: Auth protection
        self.test_auth_required_endpoints()
        
        # Summary
        print("\n" + "="*60)
        print("📊 TEST SUMMARY")
        print("="*60)
        
        passed = sum(1 for result in self.test_results if result['success'])
        total = len(self.test_results)
        
        for result in self.test_results:
            status = "✅" if result['success'] else "❌"
            print(f"{status} {result['test']}: {result['message']}")
            
        print(f"\n🎯 Results: {passed}/{total} tests passed")
        
        if passed == total:
            print("🎉 All backend API tests PASSED!")
            return True
        else:
            print(f"⚠️  {total - passed} test(s) FAILED")
            return False

def main():
    """Main test runner"""
    tester = NDXCommandAPITester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()