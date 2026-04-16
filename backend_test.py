#!/usr/bin/env python3
"""
NDX Command Backend API Testing - NEW ENDPOINTS FOCUS
Testing the 3 new endpoints as specified in review request:
1. AI Sentiment Endpoint: GET /api/ai/sentiment (requires auth)
2. Alert Edit Endpoint: PUT /api/alerts/{alert_id} (requires admin auth)  
3. Webhook No TradingView: POST /api/alerts/webhook (no auth)
"""

import requests
import json
import time
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:8001"
ADMIN_EMAIL = "admin@ndxcommand.com"
ADMIN_PASSWORD = "admin123"

class NDXTester:
    def __init__(self):
        self.base_url = BASE_URL
        self.admin_token = None
        self.test_results = []
        
    def log_result(self, test_name, success, details="", response_data=None):
        """Log test result"""
        result = {
            'test': test_name,
            'success': success,
            'details': details,
            'timestamp': datetime.now().isoformat(),
            'response_data': response_data
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
        if not success and response_data:
            print(f"   Response: {response_data}")
        print()

    def authenticate_admin(self):
        """Get admin JWT token"""
        try:
            response = requests.post(f"{self.base_url}/api/auth/login", 
                json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                self.admin_token = data.get('token')
                user = data.get('user', {})
                is_admin = user.get('is_admin', False)
                
                if self.admin_token and is_admin:
                    self.log_result("Admin Authentication", True, 
                        f"Admin login successful. User: {user.get('username', 'Unknown')}")
                    return True
                else:
                    self.log_result("Admin Authentication", False, 
                        f"Login successful but admin privileges not confirmed. is_admin: {is_admin}")
                    return False
            else:
                self.log_result("Admin Authentication", False, 
                    f"Login failed with status {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_result("Admin Authentication", False, f"Exception: {str(e)}")
            return False

    def test_ai_sentiment_endpoint(self):
        """Test AI Sentiment Endpoint: GET /api/ai/sentiment (requires auth)"""
        if not self.admin_token:
            self.log_result("AI Sentiment Endpoint", False, "No admin token available")
            return
            
        try:
            headers = {"Authorization": f"Bearer {self.admin_token}"}
            print("🤖 Calling AI Sentiment endpoint (may take 10-15 seconds)...")
            start_time = time.time()
            
            response = requests.get(f"{self.base_url}/api/ai/sentiment", 
                headers=headers, timeout=30)  # Long timeout for AI processing
            
            elapsed = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                
                # Check required fields
                required_fields = ['sentiment', 'generated_at', 'ndx_price', 'ndx_change']
                missing_fields = [field for field in required_fields if field not in data]
                
                if missing_fields:
                    self.log_result("AI Sentiment Endpoint", False, 
                        f"Missing required fields: {missing_fields}", data)
                    return
                
                # Check sentiment object structure
                sentiment = data.get('sentiment', {})
                sentiment_fields = ['overall_sentiment', 'confidence', 'summary', 'key_drivers', 'ndx_outlook', 'risk_factors', 'trade_bias']
                missing_sentiment_fields = [field for field in sentiment_fields if field not in sentiment]
                
                if missing_sentiment_fields:
                    self.log_result("AI Sentiment Endpoint", False, 
                        f"Missing sentiment fields: {missing_sentiment_fields}", data)
                    return
                
                # Validate sentiment values
                overall_sentiment = sentiment.get('overall_sentiment')
                confidence = sentiment.get('confidence')
                
                if overall_sentiment not in ['bullish', 'bearish', 'neutral']:
                    self.log_result("AI Sentiment Endpoint", False, 
                        f"Invalid overall_sentiment: {overall_sentiment}", data)
                    return
                
                if not isinstance(confidence, (int, float)) or confidence < 0 or confidence > 10:
                    self.log_result("AI Sentiment Endpoint", False, 
                        f"Invalid confidence value: {confidence}", data)
                    return
                
                self.log_result("AI Sentiment Endpoint", True, 
                    f"AI sentiment analysis successful. Sentiment: {overall_sentiment}, Confidence: {confidence}, Response time: {elapsed:.1f}s")
                
            else:
                self.log_result("AI Sentiment Endpoint", False, 
                    f"Request failed with status {response.status_code}", response.text)
                
        except Exception as e:
            self.log_result("AI Sentiment Endpoint", False, f"Exception: {str(e)}")

    def test_alert_edit_endpoint(self):
        """Test Alert Edit Endpoint: PUT /api/alerts/{alert_id} (requires admin auth)"""
        if not self.admin_token:
            self.log_result("Alert Edit Endpoint", False, "No admin token available")
            return
            
        try:
            headers = {"Authorization": f"Bearer {self.admin_token}"}
            
            # First, get existing alerts to find an alert_id
            response = requests.get(f"{self.base_url}/api/alerts", headers=headers, timeout=10)
            
            if response.status_code != 200:
                self.log_result("Alert Edit Endpoint - Get Alerts", False, 
                    f"Failed to get alerts: {response.status_code}", response.text)
                return
            
            alerts_data = response.json()
            alerts = alerts_data.get('alerts', [])
            
            if not alerts:
                self.log_result("Alert Edit Endpoint", False, "No alerts found to edit")
                return
            
            # Use the first alert for testing
            alert_id = alerts[0].get('id')
            original_title = alerts[0].get('title', '')
            
            if not alert_id:
                self.log_result("Alert Edit Endpoint", False, "No alert ID found in first alert")
                return
            
            self.log_result("Alert Edit Endpoint - Get Alerts", True, 
                f"Found {len(alerts)} alerts. Using alert_id: {alert_id}")
            
            # Now test the PUT endpoint
            update_data = {
                "title": "Updated Title - Test",
                "message": "Updated message - Test",
                "ticker": "NDX",
                "severity": "high"
            }
            
            response = requests.put(f"{self.base_url}/api/alerts/{alert_id}", 
                json=update_data, headers=headers, timeout=10)
            
            if response.status_code == 200:
                updated_alert = response.json()
                
                # Verify the update worked
                if (updated_alert.get('title') == update_data['title'] and
                    updated_alert.get('message') == update_data['message'] and
                    updated_alert.get('ticker') == update_data['ticker'] and
                    updated_alert.get('severity') == update_data['severity']):
                    
                    self.log_result("Alert Edit Endpoint", True, 
                        f"Alert {alert_id} successfully updated. Title changed from '{original_title}' to '{updated_alert.get('title')}'")
                else:
                    self.log_result("Alert Edit Endpoint", False, 
                        "Alert update response doesn't match expected values", updated_alert)
            else:
                self.log_result("Alert Edit Endpoint", False, 
                    f"PUT request failed with status {response.status_code}", response.text)
                
        except Exception as e:
            self.log_result("Alert Edit Endpoint", False, f"Exception: {str(e)}")

    def test_webhook_no_tradingview(self):
        """Test Webhook No TradingView: POST /api/alerts/webhook (no auth)"""
        try:
            # Test webhook endpoint (no auth required)
            webhook_data = {"content": "Test NDX @ 26,000"}
            
            response = requests.post(f"{self.base_url}/api/alerts/webhook", 
                json=webhook_data, timeout=10)
            
            if response.status_code == 200:
                webhook_response = response.json()
                alert_id = webhook_response.get('alert_id')
                
                if not alert_id:
                    self.log_result("Webhook No TradingView - Create", False, 
                        "No alert_id in webhook response", webhook_response)
                    return
                
                self.log_result("Webhook No TradingView - Create", True, 
                    f"Webhook alert created successfully. Alert ID: {alert_id}")
                
                # Now verify the alert was created with correct attributes
                if not self.admin_token:
                    self.log_result("Webhook No TradingView - Verify", False, 
                        "Cannot verify alert attributes without admin token")
                    return
                
                headers = {"Authorization": f"Bearer {self.admin_token}"}
                response = requests.get(f"{self.base_url}/api/alerts", headers=headers, timeout=10)
                
                if response.status_code == 200:
                    alerts_data = response.json()
                    alerts = alerts_data.get('alerts', [])
                    
                    # Find the alert we just created
                    created_alert = None
                    for alert in alerts:
                        if alert.get('id') == alert_id:
                            created_alert = alert
                            break
                    
                    if not created_alert:
                        self.log_result("Webhook No TradingView - Verify", False, 
                            f"Could not find created alert with ID {alert_id}")
                        return
                    
                    # Verify attributes
                    created_by = created_alert.get('created_by')
                    source = created_alert.get('source')
                    
                    if created_by == "NDX Command" and source == "webhook":
                        self.log_result("Webhook No TradingView - Verify", True, 
                            f"Alert correctly created with created_by='NDX Command' and source='webhook'")
                    else:
                        self.log_result("Webhook No TradingView - Verify", False, 
                            f"Alert has incorrect attributes: created_by='{created_by}', source='{source}' (expected 'NDX Command' and 'webhook')")
                else:
                    self.log_result("Webhook No TradingView - Verify", False, 
                        f"Failed to get alerts for verification: {response.status_code}")
            else:
                self.log_result("Webhook No TradingView - Create", False, 
                    f"Webhook request failed with status {response.status_code}", response.text)
                
        except Exception as e:
            self.log_result("Webhook No TradingView", False, f"Exception: {str(e)}")

    def run_all_tests(self):
        """Run all tests for the new endpoints"""
        print("🚀 Starting NDX Command Backend API Testing - NEW ENDPOINTS")
        print("=" * 60)
        print()
        
        # Step 1: Authenticate as admin
        if not self.authenticate_admin():
            print("❌ Cannot proceed without admin authentication")
            return
        
        print("🧪 Testing NEW endpoints...")
        print()
        
        # Step 2: Test the 3 new endpoints
        self.test_ai_sentiment_endpoint()
        self.test_alert_edit_endpoint()
        self.test_webhook_no_tradingview()
        
        # Summary
        print("=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for result in self.test_results if result['success'])
        total = len(self.test_results)
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        print(f"Success Rate: {(passed/total*100):.1f}%" if total > 0 else "0%")
        print()
        
        # Show failed tests
        failed_tests = [result for result in self.test_results if not result['success']]
        if failed_tests:
            print("❌ FAILED TESTS:")
            for result in failed_tests:
                print(f"  - {result['test']}: {result['details']}")
        else:
            print("✅ ALL TESTS PASSED!")
        
        print()
        return passed == total

if __name__ == "__main__":
    tester = NDXTester()
    success = tester.run_all_tests()
    exit(0 if success else 1)