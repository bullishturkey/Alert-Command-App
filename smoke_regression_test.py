#!/usr/bin/env python3
"""
Smoke regression test for Alerts Command backend after push/recap changes.
Tests the 10 acceptance scenarios from the review request.
"""
import os
import sys
import time
import json
import base64
import requests
from datetime import datetime, timezone

BACKEND_URL = "https://alert-refresh.preview.emergentagent.com/api"
ADMIN_EMAIL = "gregrussell90@gmail.com"
ADMIN_PASSWORD = "Liltony2026"
WEBHOOK_SECRET = "hbd30zqEwACjWgnBbq0V4TYLzl7Da9m2b3BWcRNms8WSl7ntX27LEQo7IdduXgwV"

results = []
def record(name, passed, detail=""):
    status = "✅" if passed else "❌"
    print(f"{status} {name}: {detail}")
    results.append((name, passed, detail))

def decode_jwt_exp(token: str) -> int:
    parts = token.split('.')
    payload = parts[1] + '=' * (-len(parts[1]) % 4)
    data = json.loads(base64.urlsafe_b64decode(payload))
    return int(data.get('exp', 0))

def main():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})

    # Test 1: Login w/ remember_me=true → 200 + token; JWT exp ~90d
    r = s.post(f"{BACKEND_URL}/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "remember_me": True
    }, timeout=30)
    if r.status_code != 200:
        record("T1 Login remember_me=true", False, f"HTTP {r.status_code} body={r.text[:200]}")
        return
    body = r.json()
    token = body.get('token') or body.get('access_token')
    if not token:
        record("T1 Login remember_me=true", False, f"No token in body: {body}")
        return
    exp = decode_jwt_exp(token)
    now = int(time.time())
    ttl_days = (exp - now) / 86400.0
    ok = 85 <= ttl_days <= 95
    record("T1 Login remember_me=true 90d JWT", ok, f"TTL={ttl_days:.1f}d (exp={exp})")
    admin_headers = {"Authorization": f"Bearer {token}"}

    # Test 2: Webhook bullish
    r2 = s.post(f"{BACKEND_URL}/alerts/webhook",
                headers={"X-Webhook-Secret": WEBHOOK_SECRET, "Content-Type": "application/json"},
                json={"content": "NDX bullish breakout @ 26500"}, timeout=30)
    ok = r2.status_code == 200 and r2.json().get('alert_id')
    record("T2 Webhook bullish NDX", ok, f"HTTP {r2.status_code} alert_id={r2.json().get('alert_id') if r2.status_code==200 else r2.text[:200]}")

    # Test 3: Webhook bearish AAPL
    r3 = s.post(f"{BACKEND_URL}/alerts/webhook",
                headers={"X-Webhook-Secret": WEBHOOK_SECRET, "Content-Type": "application/json"},
                json={"content": "AAPL bearish breakdown 172.50"}, timeout=30)
    ok = r3.status_code == 200 and r3.json().get('alert_id')
    record("T3 Webhook bearish AAPL", ok, f"HTTP {r3.status_code} alert_id={r3.json().get('alert_id') if r3.status_code==200 else r3.text[:200]}")

    # Test 4: Webhook chop/breakeven TSLA - expect type='signal'
    r4 = s.post(f"{BACKEND_URL}/alerts/webhook",
                headers={"X-Webhook-Secret": WEBHOOK_SECRET, "Content-Type": "application/json"},
                json={"content": "TSLA chop / breakeven setup 245"}, timeout=30)
    ok4_http = r4.status_code == 200
    alert_id4 = r4.json().get('alert_id') if ok4_http else None
    # Verify type=signal by reading alerts
    type4 = None
    if alert_id4:
        ra = s.get(f"{BACKEND_URL}/alerts", headers=admin_headers, timeout=30)
        if ra.status_code == 200:
            alerts_list = ra.json().get('alerts', [])
            for a in alerts_list:
                if a.get('id') == alert_id4:
                    type4 = a.get('type')
                    break
    record("T4 Webhook TSLA chop type=signal", ok4_http and type4 == 'signal',
           f"HTTP {r4.status_code} type={type4}")

    # Test 5: GET /api/ai/sentiment with admin token
    r5 = s.get(f"{BACKEND_URL}/ai/sentiment", headers=admin_headers, timeout=30)
    if r5.status_code != 200:
        record("T5 ai/sentiment", False, f"HTTP {r5.status_code} {r5.text[:200]}")
    else:
        b5 = r5.json()
        gen = b5.get('generated_at')
        mode = b5.get('mode')
        sentiment = b5.get('sentiment')
        # validate ISO
        iso_ok = False
        try:
            if gen:
                datetime.fromisoformat(gen.replace('Z', '+00:00'))
                iso_ok = True
        except Exception:
            pass
        mode_ok = mode in ('live', 'weekly_recap', 'daily_recap')
        sent_ok = isinstance(sentiment, dict) and len(sentiment) > 0
        record("T5 ai/sentiment fields", iso_ok and mode_ok and sent_ok,
               f"mode={mode} generated_at={gen} sentiment_present={sent_ok}")

    # Test 6: GET /api/alerts admin
    r6 = s.get(f"{BACKEND_URL}/alerts", headers=admin_headers, timeout=30)
    ok = r6.status_code == 200 and isinstance(r6.json().get('alerts'), list)
    record("T6 GET /alerts", ok, f"HTTP {r6.status_code} count={len(r6.json().get('alerts', [])) if ok else 'n/a'}")

    # Test 7: GET /api/preflight admin
    r7 = s.get(f"{BACKEND_URL}/preflight", headers=admin_headers, timeout=30)
    ok = r7.status_code == 200
    record("T7 GET /preflight", ok, f"HTTP {r7.status_code}")

    # Test 8: GET /api/admin/stats
    r8 = s.get(f"{BACKEND_URL}/admin/stats", headers=admin_headers, timeout=30)
    if r8.status_code == 200:
        b8 = r8.json()
        ok = all(isinstance(b8.get(k), int) for k in ['users', 'alerts', 'messages'])
        record("T8 GET /admin/stats", ok, f"users={b8.get('users')} alerts={b8.get('alerts')} messages={b8.get('messages')}")
    else:
        record("T8 GET /admin/stats", False, f"HTTP {r8.status_code} {r8.text[:200]}")

    # Test 9: GET /api/admin/users
    r9 = s.get(f"{BACKEND_URL}/admin/users", headers=admin_headers, timeout=30)
    if r9.status_code == 200:
        b9 = r9.json()
        ok = isinstance(b9.get('users'), list)
        record("T9 GET /admin/users", ok, f"users_count={len(b9.get('users', []))}")
    else:
        record("T9 GET /admin/users", False, f"HTTP {r9.status_code} {r9.text[:200]}")

    # Test 10: webhook no secret → 403
    r10 = s.post(f"{BACKEND_URL}/alerts/webhook",
                 headers={"Content-Type": "application/json"},
                 json={"content": "no secret test"}, timeout=30)
    record("T10 webhook no secret → 403", r10.status_code == 403,
           f"HTTP {r10.status_code}")

    # Summary
    print("\n" + "=" * 70)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"RESULT: {passed}/{len(results)} tests passed")
    if passed != len(results):
        sys.exit(1)

if __name__ == "__main__":
    main()
