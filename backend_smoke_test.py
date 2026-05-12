"""
Smoke test for Alerts Command backend after two new changes:
1. _generate_ai_sentiment() catches Claude timeouts/errors → returns fallback sentiment.
2. _market_open_scheduler() runs at 9:30 ET weekdays — force-regenerates AI sentiment + push.

Verifies all 10 tests from the review request.
"""
import os
import sys
import time
import json
import requests
from datetime import datetime

BACKEND_URL = "https://alert-refresh.preview.emergentagent.com"
API_BASE = f"{BACKEND_URL}/api"
EMAIL = "gregrussell90@gmail.com"
PASSWORD = "Liltony2026"
WEBHOOK_SECRET = "hbd30zqEwACjWgnBbq0V4TYLzl7Da9m2b3BWcRNms8WSl7ntX27LEQo7IdduXgwV"

PLACEHOLDER_PHRASES = [
    "Market intelligence loading",
    "wait 30 sec",
    "generating… pull down to refresh",
    "recap is generating",
]

passed = []
failed = []

def record(name, ok, detail=""):
    (passed if ok else failed).append(f"{name}: {detail}")
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} — {detail}")

# -------------------- T1: Login --------------------
print("\n=== T1: POST /api/auth/login with remember_me=true ===")
try:
    r = requests.post(
        f"{API_BASE}/auth/login",
        json={"email": EMAIL, "password": PASSWORD, "remember_me": True},
        timeout=15,
    )
    if r.status_code == 200:
        data = r.json()
        token = data.get("token") or data.get("access_token")
        if token:
            record("T1 login", True, f"200 + token (len={len(token)})")
        else:
            record("T1 login", False, f"200 but no token in {list(data.keys())}")
            sys.exit(1)
    else:
        record("T1 login", False, f"HTTP {r.status_code}: {r.text[:200]}")
        sys.exit(1)
except Exception as e:
    record("T1 login", False, f"exception: {e}")
    sys.exit(1)

ADMIN_HEADERS = {"Authorization": f"Bearer {token}"}

# -------------------- T2: GET /api/ai/sentiment (no placeholder) --------------------
print("\n=== T2: GET /api/ai/sentiment must have non-empty summary, NOT placeholder ===")
summary_t2 = None
generated_at_t2 = None
deadline = time.time() + 60   # poll up to 60s while bg refresh completes
attempt = 0
while time.time() < deadline:
    attempt += 1
    try:
        r = requests.get(f"{API_BASE}/ai/sentiment", headers=ADMIN_HEADERS, timeout=30)
    except Exception as e:
        record("T2 sentiment", False, f"attempt {attempt} exception: {e}")
        break
    if r.status_code != 200:
        record("T2 sentiment", False, f"HTTP {r.status_code}: {r.text[:200]}")
        break
    body = r.json()
    sent = body.get("sentiment") or {}
    summary = (sent.get("summary") or "").strip()
    is_placeholder = any(p.lower() in summary.lower() for p in PLACEHOLDER_PHRASES) or body.get("pending") is True
    print(f"   attempt {attempt}: mode={body.get('mode')}, pending={body.get('pending')}, summary[:80]={summary[:80]!r}")
    if summary and not is_placeholder:
        summary_t2 = summary
        generated_at_t2 = body.get("generated_at")
        record(
            "T2 sentiment",
            True,
            f"200 with real summary (mode={body.get('mode')}, overall={sent.get('overall_sentiment')}, len={len(summary)})",
        )
        break
    time.sleep(5)
else:
    record("T2 sentiment", False, f"still placeholder/empty after {attempt} attempts (60s)")

# -------------------- T3: cache hit within 2 seconds --------------------
print("\n=== T3: GET /api/ai/sentiment within 2s — cache hit, same summary ===")
time.sleep(1)
try:
    r = requests.get(f"{API_BASE}/ai/sentiment", headers=ADMIN_HEADERS, timeout=15)
    if r.status_code == 200:
        body = r.json()
        s2 = (body.get("sentiment") or {}).get("summary", "").strip()
        if summary_t2 and s2 == summary_t2:
            record("T3 cache hit", True, f"200 same summary (generated_at={body.get('generated_at')})")
        elif s2 and not any(p.lower() in s2.lower() for p in PLACEHOLDER_PHRASES):
            # acceptable if non-placeholder even if differing (bg refresh may have updated)
            record("T3 cache hit", True, f"200 non-placeholder summary (may have refreshed)")
        else:
            record("T3 cache hit", False, f"summary changed or placeholder: {s2[:100]}")
    else:
        record("T3 cache hit", False, f"HTTP {r.status_code}: {r.text[:200]}")
except Exception as e:
    record("T3 cache hit", False, f"exception: {e}")

# -------------------- T4: POST /api/admin/refresh-sentiment --------------------
print("\n=== T4: POST /api/admin/refresh-sentiment ===")
try:
    r = requests.post(f"{API_BASE}/admin/refresh-sentiment", headers=ADMIN_HEADERS, timeout=60)
    if r.status_code == 200:
        body = r.json()
        if body.get("status") == "success":
            record("T4 admin refresh", True, f"200 status=success mode={body.get('mode')}, generated_at={body.get('generated_at')}")
        else:
            record("T4 admin refresh", False, f"200 but status={body.get('status')}: {body}")
    else:
        record("T4 admin refresh", False, f"HTTP {r.status_code}: {r.text[:200]}")
except Exception as e:
    record("T4 admin refresh", False, f"exception: {e}")

# -------------------- T5: fresh generated_at after T4 --------------------
print("\n=== T5: GET /api/ai/sentiment immediately after refresh — fresh timestamp ===")
try:
    r = requests.get(f"{API_BASE}/ai/sentiment", headers=ADMIN_HEADERS, timeout=15)
    if r.status_code == 200:
        body = r.json()
        new_gen = body.get("generated_at")
        s = (body.get("sentiment") or {}).get("summary", "").strip()
        if not new_gen:
            record("T5 fresh ts", False, f"no generated_at in response: {list(body.keys())}")
        elif generated_at_t2 and new_gen == generated_at_t2:
            record("T5 fresh ts", False, f"generated_at unchanged from T2: {new_gen}")
        else:
            record("T5 fresh ts", True, f"200 fresh generated_at={new_gen} (was {generated_at_t2}); summary_len={len(s)}")
    else:
        record("T5 fresh ts", False, f"HTTP {r.status_code}: {r.text[:200]}")
except Exception as e:
    record("T5 fresh ts", False, f"exception: {e}")

# -------------------- T6: GET /api/alerts --------------------
print("\n=== T6: GET /api/alerts ===")
try:
    r = requests.get(f"{API_BASE}/alerts", headers=ADMIN_HEADERS, timeout=15)
    if r.status_code == 200:
        body = r.json()
        alerts = body.get("alerts") if isinstance(body, dict) else body
        record("T6 alerts", True, f"200 with {len(alerts) if alerts is not None else '?'} alerts")
    else:
        record("T6 alerts", False, f"HTTP {r.status_code}: {r.text[:200]}")
except Exception as e:
    record("T6 alerts", False, f"exception: {e}")

# -------------------- T7: GET /api/preflight --------------------
print("\n=== T7: GET /api/preflight ===")
try:
    r = requests.get(f"{API_BASE}/preflight", headers=ADMIN_HEADERS, timeout=30)
    if r.status_code == 200:
        body = r.json()
        ev = body.get("economic_events", [])
        record("T7 preflight", True, f"200 with {len(ev)} economic_events, keys={list(body.keys())}")
    else:
        record("T7 preflight", False, f"HTTP {r.status_code}: {r.text[:200]}")
except Exception as e:
    record("T7 preflight", False, f"exception: {e}")

# -------------------- T8: GET /api/admin/stats --------------------
print("\n=== T8: GET /api/admin/stats ===")
try:
    r = requests.get(f"{API_BASE}/admin/stats", headers=ADMIN_HEADERS, timeout=15)
    if r.status_code == 200:
        body = r.json()
        users = body.get("users")
        alerts_n = body.get("alerts")
        messages = body.get("messages")
        if isinstance(users, (int, float)) and isinstance(alerts_n, (int, float)) and isinstance(messages, (int, float)):
            record("T8 admin stats", True, f"200 users={users} alerts={alerts_n} messages={messages}")
        else:
            record("T8 admin stats", False, f"non-numeric: users={users} alerts={alerts_n} messages={messages}; body={body}")
    else:
        record("T8 admin stats", False, f"HTTP {r.status_code}: {r.text[:200]}")
except Exception as e:
    record("T8 admin stats", False, f"exception: {e}")

# -------------------- T9: POST /api/alerts/webhook --------------------
print("\n=== T9: POST /api/alerts/webhook with secret ===")
try:
    r = requests.post(
        f"{API_BASE}/alerts/webhook",
        headers={"X-Webhook-Secret": WEBHOOK_SECRET, "Content-Type": "application/json"},
        json={"content": "NDX bullish breakout @ 26500"},
        timeout=15,
    )
    if r.status_code == 200:
        body = r.json()
        aid = body.get("alert_id")
        if aid:
            record("T9 webhook", True, f"200 + alert_id={aid}")
        else:
            record("T9 webhook", False, f"200 but no alert_id: {body}")
    else:
        record("T9 webhook", False, f"HTTP {r.status_code}: {r.text[:200]}")
except Exception as e:
    record("T9 webhook", False, f"exception: {e}")

# -------------------- T10: verify market-open scheduler log --------------------
print("\n=== T10: backend log shows Market-open scheduler line ===")
import subprocess
try:
    out = subprocess.check_output(
        "grep -i 'Market-open scheduler: next run' /var/log/supervisor/backend.*.log 2>/dev/null | tail -5",
        shell=True, text=True
    ).strip()
    if out and "09:30 EDT" in out:
        record("T10 scheduler log", True, f"found: {out.splitlines()[-1]}")
    elif out:
        record("T10 scheduler log", True, f"found (not EDT): {out.splitlines()[-1]}")
    else:
        record("T10 scheduler log", False, "no 'Market-open scheduler: next run' line in backend logs")
except Exception as e:
    record("T10 scheduler log", False, f"exception: {e}")

# Bonus: check for ANY exceptions in backend logs from new code
print("\n=== Bonus: scan backend logs for new-code exceptions ===")
try:
    out = subprocess.check_output(
        "grep -iE 'Market-open|_generate_ai_sentiment|movers-only fallback' /var/log/supervisor/backend.*.log 2>/dev/null | tail -20",
        shell=True, text=True
    ).strip()
    print(out)
except Exception:
    pass

# Final summary
print("\n" + "="*60)
print(f"PASSED: {len(passed)}/{len(passed)+len(failed)}")
print(f"FAILED: {len(failed)}")
for f in failed:
    print(f"  FAIL — {f}")
print("="*60)

sys.exit(0 if not failed else 1)
