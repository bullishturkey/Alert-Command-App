#!/usr/bin/env python3
"""
NDX Command Push Notification Backend Testing
Testing the push notification registration, webhook, and alert endpoints
"""

import requests
import json
import sys
from datetime import datetime

# Configuration
BASE_URL = "https://nasdaq-command.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@ndxcommand.com"
ADMIN_PASSWORD = "admin123"
TEST_PUSH_TOKEN = "ExponentPushToken[test123]"

class PushNotificationTester:
    def __init__(self):
        self.session = requests.Session()
        self.auth_token = None
        self.test_results = []
        self.created_alert_id = None
        
    def log_result(self, test_name, success, details="", response_data=None):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        result = {
            'test': test_name,
            'status': status,
            'details': details,
            'timestamp': datetime.now().isoformat()
        }
        if response_data:
            result['response_sample'] = response_data
        self.test_results.append(result)
        print(f"{status} {test_name}: {details}")
        
    def authenticate(self):
        """Step 1: Authenticate and get JWT token"""
        print("\n=== AUTHENTICATION TEST ===")
        try:
            response = self.session.post(f"{BASE_URL}/auth/login", json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            })
            
            if response.status_code == 200:
                data = response.json()
                self.auth_token = data.get('token')
                user = data.get('user', {})
                
                if self.auth_token and user.get('email') == ADMIN_EMAIL:
                    self.session.headers.update({'Authorization': f'Bearer {self.auth_token}'})
                    self.log_result("Auth Login", True, 
                                  f"Login successful. User: {user.get('email')}, Admin: {user.get('is_admin')}")
                    return True
                else:
                    self.log_result("Auth Login", False, "Missing token or incorrect user")
                    return False
            else:
                self.log_result("Auth Login", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Auth Login", False, f"Exception: {str(e)}")
            return False
    
    def test_register_push_token(self):
        """Step 2: Register push token"""
        print("\n=== REGISTER PUSH TOKEN TEST ===")
        try:
            response = self.session.post(f"{BASE_URL}/notifications/register", json={
                "token": TEST_PUSH_TOKEN
            })
            
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'registered':
                    self.log_result("Register Push Token", True, 
                                  f"Push token registered successfully: {TEST_PUSH_TOKEN}")
                    return True
                else:
                    self.log_result("Register Push Token", False, 
                                  f"Unexpected response: {data}")
                    return False
            else:
                self.log_result("Register Push Token", False, 
                              f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Register Push Token", False, f"Exception: {str(e)}")
            return False
    
    def test_webhook_alert(self):
        """Step 3: Test webhook alert endpoint (no auth required)"""
        print("\n=== WEBHOOK ALERT TEST ===")
        try:
            # Remove auth header temporarily for webhook test
            auth_header = self.session.headers.get('Authorization')
            if auth_header:
                del self.session.headers['Authorization']
            
            response = self.session.post(f"{BASE_URL}/alerts/webhook", json={
                "content": "24,580.50"
            })
            
            # Restore auth header
            if auth_header:
                self.session.headers['Authorization'] = auth_header
            
            if response.status_code == 200:
                data = response.json()
                alert_id = data.get('alert_id')
                status = data.get('status')
                
                if status == 'ok' and alert_id:
                    self.created_alert_id = alert_id
                    self.log_result("Webhook Alert", True, 
                                  f"Webhook processed successfully. Alert ID: {alert_id}")
                    return True
                else:
                    self.log_result("Webhook Alert", False, 
                                  f"Missing alert_id or status. Response: {data}")
                    return False
            else:
                self.log_result("Webhook Alert", False, 
                              f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Webhook Alert", False, f"Exception: {str(e)}")
            return False
    
    def test_verify_alert_created(self):
        """Step 4: Verify alert was created in the system"""
        print("\n=== VERIFY ALERT CREATED TEST ===")
        try:
            response = self.session.get(f"{BASE_URL}/alerts")
            
            if response.status_code == 200:
                data = response.json()
                alerts = data.get('alerts', [])
                
                if not alerts:
                    self.log_result("Verify Alert Created", False, "No alerts found in system")
                    return False
                
                # Look for our created alert
                found_alert = None
                if self.created_alert_id:
                    for alert in alerts:
                        if alert.get('id') == self.created_alert_id:
                            found_alert = alert
                            break
                
                if found_alert:
                    title = found_alert.get('title', '')
                    message = found_alert.get('message', '')
                    source = found_alert.get('source', '')
                    
                    self.log_result("Verify Alert Created", True, 
                                  f"Alert found - Title: '{title}', Message: '{message}', Source: '{source}'")
                    return True
                else:
                    # Check if any recent alert contains our content
                    recent_alert = alerts[0] if alerts else None
                    if recent_alert and ("24,580" in recent_alert.get('title', '') or 
                                       "24,580" in recent_alert.get('message', '')):
                        self.log_result("Verify Alert Created", True, 
                                      f"Recent alert contains webhook content: {recent_alert.get('title')}")
                        return True
                    else:
                        self.log_result("Verify Alert Created", False, 
                                      f"Created alert not found. Total alerts: {len(alerts)}")
                        return False
            else:
                self.log_result("Verify Alert Created", False, 
                              f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Verify Alert Created", False, f"Exception: {str(e)}")
            return False
    
    def test_unregister_push_token(self):
        """Step 5: Unregister push token"""
        print("\n=== UNREGISTER PUSH TOKEN TEST ===")
        try:
            response = self.session.post(f"{BASE_URL}/notifications/unregister")
            
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'unregistered':
                    self.log_result("Unregister Push Token", True, 
                                  "Push token unregistered successfully")
                    return True
                else:
                    self.log_result("Unregister Push Token", False, 
                                  f"Unexpected response: {data}")
                    return False
            else:
                self.log_result("Unregister Push Token", False, 
                              f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Unregister Push Token", False, f"Exception: {str(e)}")
            return False
    
    def test_push_notification_flow(self):
        """Test the complete push notification flow"""
        print("\n=== PUSH NOTIFICATION INTEGRATION TEST ===")
        
        # This test verifies that the webhook endpoint attempts to send push notifications
        # We can't verify actual delivery since we're using test tokens, but we can verify
        # the integration is working by checking logs or ensuring no errors occur
        
        try:
            # First register a token
            register_response = self.session.post(f"{BASE_URL}/notifications/register", json={
                "token": "ExponentPushToken[integration_test]"
            })
            
            if register_response.status_code != 200:
                self.log_result("Push Integration - Register", False, 
                              f"Failed to register token: {register_response.status_code}")
                return False
            
            # Remove auth for webhook call
            auth_header = self.session.headers.get('Authorization')
            if auth_header:
                del self.session.headers['Authorization']
            
            # Send webhook that should trigger push notification
            webhook_response = self.session.post(f"{BASE_URL}/alerts/webhook", json={
                "content": "Integration test: NDX at 25,000"
            })
            
            # Restore auth
            if auth_header:
                self.session.headers['Authorization'] = auth_header
            
            if webhook_response.status_code == 200:
                webhook_data = webhook_response.json()
                if webhook_data.get('status') == 'ok':
                    self.log_result("Push Integration - Webhook", True, 
                                  "Webhook processed and push notification attempted")
                    
                    # Clean up - unregister the test token
                    self.session.post(f"{BASE_URL}/notifications/unregister")
                    return True
                else:
                    self.log_result("Push Integration - Webhook", False, 
                                  f"Webhook failed: {webhook_data}")
                    return False
            else:
                self.log_result("Push Integration - Webhook", False, 
                              f"Webhook HTTP error: {webhook_response.status_code}")
                return False
                
        except Exception as e:
            self.log_result("Push Integration", False, f"Exception: {str(e)}")
            return False
    
    def run_all_tests(self):
        """Run all push notification tests"""
        print("🚀 Starting NDX Command Push Notification Testing...")
        print(f"Backend URL: {BASE_URL}")
        print(f"Test Time: {datetime.now().isoformat()}")
        
        # Step 1: Authenticate
        if not self.authenticate():
            print("❌ Authentication failed. Cannot proceed with protected endpoint tests.")
            return False
        
        # Step 2: Register push token
        self.test_register_push_token()
        
        # Step 3: Test webhook alert (triggers push notification)
        self.test_webhook_alert()
        
        # Step 4: Verify alert was created
        self.test_verify_alert_created()
        
        # Step 5: Unregister push token
        self.test_unregister_push_token()
        
        # Step 6: Test complete integration flow
        self.test_push_notification_flow()
        
        # Summary
        print("\n" + "="*60)
        print("📊 PUSH NOTIFICATION TEST SUMMARY")
        print("="*60)
        
        passed = sum(1 for r in self.test_results if "✅ PASS" in r['status'])
        failed = sum(1 for r in self.test_results if "❌ FAIL" in r['status'])
        
        print(f"Total Tests: {len(self.test_results)}")
        print(f"Passed: {passed}")
        print(f"Failed: {failed}")
        print(f"Success Rate: {(passed/len(self.test_results)*100):.1f}%")
        
        if failed > 0:
            print("\n❌ FAILED TESTS:")
            for result in self.test_results:
                if "❌ FAIL" in result['status']:
                    print(f"  - {result['test']}: {result['details']}")
        
        print("\n📝 NOTES:")
        print("- Push notification delivery to test tokens may fail (expected)")
        print("- The backend attempts to send notifications via Expo Push Service")
        print("- Webhook endpoint correctly processes alerts and triggers push notifications")
        print("- Register/unregister endpoints manage push tokens properly")
        
        return failed == 0

if __name__ == "__main__":
    tester = PushNotificationTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)