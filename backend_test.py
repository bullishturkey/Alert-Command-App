#!/usr/bin/env python3
"""
NDX Command Backend API Testing - NEW Endpoints
Testing the newly implemented Watchlist, Videos, and Quote Multi endpoints
"""

import requests
import json
import sys
from datetime import datetime

# Configuration
BASE_URL = "https://nasdaq-command.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@ndxcommand.com"
ADMIN_PASSWORD = "admin123"

class NDXCommandTester:
    def __init__(self):
        self.session = requests.Session()
        self.auth_token = None
        self.test_results = []
        
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
                
                if self.auth_token and user.get('is_admin'):
                    self.session.headers.update({'Authorization': f'Bearer {self.auth_token}'})
                    self.log_result("Auth Login", True, 
                                  f"Admin login successful. User: {user.get('email')}, Admin: {user.get('is_admin')}")
                    return True
                else:
                    self.log_result("Auth Login", False, "Missing token or admin privileges")
                    return False
            else:
                self.log_result("Auth Login", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Auth Login", False, f"Exception: {str(e)}")
            return False
    
    def test_watchlist_endpoints(self):
        """Test NEW Watchlist endpoints"""
        print("\n=== WATCHLIST ENDPOINTS TEST ===")
        
        # Test 1: GET /api/watchlist - should return default symbols (10 stocks)
        try:
            response = self.session.get(f"{BASE_URL}/watchlist")
            if response.status_code == 200:
                data = response.json()
                symbols = data.get('symbols', [])
                if len(symbols) == 10:
                    self.log_result("Watchlist GET (Default)", True, 
                                  f"Retrieved {len(symbols)} default symbols: {symbols[:3]}...")
                else:
                    self.log_result("Watchlist GET (Default)", False, 
                                  f"Expected 10 symbols, got {len(symbols)}")
            else:
                self.log_result("Watchlist GET (Default)", False, 
                              f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Watchlist GET (Default)", False, f"Exception: {str(e)}")
        
        # Test 2: POST /api/watchlist/add - add NFLX
        try:
            response = self.session.post(f"{BASE_URL}/watchlist/add", json={"symbol": "NFLX"})
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'added' and data.get('symbol') == 'NFLX':
                    self.log_result("Watchlist ADD NFLX", True, "NFLX added successfully")
                else:
                    self.log_result("Watchlist ADD NFLX", False, f"Unexpected response: {data}")
            else:
                self.log_result("Watchlist ADD NFLX", False, 
                              f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Watchlist ADD NFLX", False, f"Exception: {str(e)}")
        
        # Test 3: GET /api/watchlist - should now include NFLX (11 symbols)
        try:
            response = self.session.get(f"{BASE_URL}/watchlist")
            if response.status_code == 200:
                data = response.json()
                symbols = data.get('symbols', [])
                if len(symbols) == 11 and 'NFLX' in symbols:
                    self.log_result("Watchlist GET (After Add)", True, 
                                  f"Now has {len(symbols)} symbols including NFLX")
                else:
                    self.log_result("Watchlist GET (After Add)", False, 
                                  f"Expected 11 symbols with NFLX, got {len(symbols)}, NFLX present: {'NFLX' in symbols}")
            else:
                self.log_result("Watchlist GET (After Add)", False, 
                              f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Watchlist GET (After Add)", False, f"Exception: {str(e)}")
        
        # Test 4: POST /api/watchlist/remove - remove NFLX
        try:
            response = self.session.post(f"{BASE_URL}/watchlist/remove", json={"symbol": "NFLX"})
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'removed' and data.get('symbol') == 'NFLX':
                    self.log_result("Watchlist REMOVE NFLX", True, "NFLX removed successfully")
                else:
                    self.log_result("Watchlist REMOVE NFLX", False, f"Unexpected response: {data}")
            else:
                self.log_result("Watchlist REMOVE NFLX", False, 
                              f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Watchlist REMOVE NFLX", False, f"Exception: {str(e)}")
        
        # Test 5: GET /api/watchlist - should be back to 10 symbols
        try:
            response = self.session.get(f"{BASE_URL}/watchlist")
            if response.status_code == 200:
                data = response.json()
                symbols = data.get('symbols', [])
                if len(symbols) == 10 and 'NFLX' not in symbols:
                    self.log_result("Watchlist GET (After Remove)", True, 
                                  f"Back to {len(symbols)} symbols, NFLX removed")
                else:
                    self.log_result("Watchlist GET (After Remove)", False, 
                                  f"Expected 10 symbols without NFLX, got {len(symbols)}, NFLX present: {'NFLX' in symbols}")
            else:
                self.log_result("Watchlist GET (After Remove)", False, 
                              f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Watchlist GET (After Remove)", False, f"Exception: {str(e)}")
    
    def test_videos_endpoints(self):
        """Test NEW Videos endpoints"""
        print("\n=== VIDEOS ENDPOINTS TEST ===")
        
        # Test 1: GET /api/videos - should return empty list initially
        try:
            response = self.session.get(f"{BASE_URL}/videos")
            if response.status_code == 200:
                data = response.json()
                videos = data.get('videos', [])
                self.log_result("Videos GET (Initial)", True, 
                              f"Retrieved {len(videos)} videos (expected empty or existing)")
            else:
                self.log_result("Videos GET (Initial)", False, 
                              f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Videos GET (Initial)", False, f"Exception: {str(e)}")
        
        # Test 2: POST /api/videos - create new video (admin required)
        video_data = {
            "title": "NDX Trading Basics",
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "description": "Learn the basics of NDX trading",
            "category": "Beginner"
        }
        created_video_id = None
        
        try:
            response = self.session.post(f"{BASE_URL}/videos", json=video_data)
            if response.status_code == 200:
                data = response.json()
                created_video_id = data.get('id')
                embed_url = data.get('embed_url')
                
                if created_video_id and embed_url and 'youtube.com/embed' in embed_url:
                    self.log_result("Videos CREATE", True, 
                                  f"Video created with ID: {created_video_id}, embed_url extracted: {embed_url[:50]}...")
                else:
                    self.log_result("Videos CREATE", False, 
                                  f"Missing ID or embed_url in response: {data}")
            else:
                self.log_result("Videos CREATE", False, 
                              f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Videos CREATE", False, f"Exception: {str(e)}")
        
        # Test 3: GET /api/videos - should now return the created video
        try:
            response = self.session.get(f"{BASE_URL}/videos")
            if response.status_code == 200:
                data = response.json()
                videos = data.get('videos', [])
                found_video = None
                for video in videos:
                    if video.get('title') == "NDX Trading Basics":
                        found_video = video
                        break
                
                if found_video and found_video.get('embed_url'):
                    self.log_result("Videos GET (After Create)", True, 
                                  f"Found created video with embed_url: {found_video.get('embed_url')[:50]}...")
                else:
                    self.log_result("Videos GET (After Create)", False, 
                                  "Created video not found or missing embed_url")
            else:
                self.log_result("Videos GET (After Create)", False, 
                              f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Videos GET (After Create)", False, f"Exception: {str(e)}")
        
        # Test 4: GET /api/videos/categories
        try:
            response = self.session.get(f"{BASE_URL}/videos/categories")
            if response.status_code == 200:
                data = response.json()
                categories = data.get('categories', [])
                if categories and 'Beginner' in categories:
                    self.log_result("Videos GET Categories", True, 
                                  f"Retrieved categories: {categories}")
                else:
                    self.log_result("Videos GET Categories", False, 
                                  f"Expected categories with 'Beginner', got: {categories}")
            else:
                self.log_result("Videos GET Categories", False, 
                              f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Videos GET Categories", False, f"Exception: {str(e)}")
        
        # Test 5: DELETE /api/videos/{id} - delete the created video (admin required)
        if created_video_id:
            try:
                response = self.session.delete(f"{BASE_URL}/videos/{created_video_id}")
                if response.status_code == 200:
                    data = response.json()
                    if data.get('status') == 'deleted':
                        self.log_result("Videos DELETE", True, f"Video {created_video_id} deleted successfully")
                    else:
                        self.log_result("Videos DELETE", False, f"Unexpected response: {data}")
                else:
                    self.log_result("Videos DELETE", False, 
                                  f"HTTP {response.status_code}: {response.text}")
            except Exception as e:
                self.log_result("Videos DELETE", False, f"Exception: {str(e)}")
        else:
            self.log_result("Videos DELETE", False, "No video ID to delete (creation failed)")
    
    def test_quote_multi_endpoint(self):
        """Test NEW Quote Multi endpoint"""
        print("\n=== QUOTE MULTI ENDPOINT TEST ===")
        
        # Test: GET /api/market/quote-multi?symbols=AAPL,MSFT,NVDA
        try:
            response = self.session.get(f"{BASE_URL}/market/quote-multi?symbols=AAPL,MSFT,NVDA")
            if response.status_code == 200:
                data = response.json()
                quotes = data.get('quotes', [])
                
                if len(quotes) == 3:
                    symbols_found = [q.get('symbol') for q in quotes]
                    expected_symbols = ['AAPL', 'MSFT', 'NVDA']
                    
                    if all(sym in symbols_found for sym in expected_symbols):
                        # Check if quotes have required fields
                        sample_quote = quotes[0]
                        required_fields = ['symbol', 'name', 'price', 'change', 'changePercent', 'timestamp']
                        missing_fields = [field for field in required_fields if field not in sample_quote]
                        
                        if not missing_fields:
                            self.log_result("Quote Multi", True, 
                                          f"Retrieved 3 quotes for {symbols_found}, all required fields present",
                                          sample_quote)
                        else:
                            self.log_result("Quote Multi", False, 
                                          f"Missing required fields: {missing_fields}")
                    else:
                        self.log_result("Quote Multi", False, 
                                      f"Expected symbols {expected_symbols}, got {symbols_found}")
                else:
                    self.log_result("Quote Multi", False, 
                                  f"Expected 3 quotes, got {len(quotes)}")
            else:
                self.log_result("Quote Multi", False, 
                              f"HTTP {response.status_code}: {response.text}")
        except Exception as e:
            self.log_result("Quote Multi", False, f"Exception: {str(e)}")
    
    def run_all_tests(self):
        """Run all NEW endpoint tests"""
        print("🚀 Starting NDX Command NEW Endpoints Testing...")
        print(f"Backend URL: {BASE_URL}")
        print(f"Test Time: {datetime.now().isoformat()}")
        
        # Step 1: Authenticate
        if not self.authenticate():
            print("❌ Authentication failed. Cannot proceed with protected endpoint tests.")
            return False
        
        # Step 2: Test NEW endpoints
        self.test_watchlist_endpoints()
        self.test_videos_endpoints()
        self.test_quote_multi_endpoint()
        
        # Summary
        print("\n" + "="*60)
        print("📊 TEST SUMMARY")
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
        
        return failed == 0

if __name__ == "__main__":
    tester = NDXCommandTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)