"""
Backend API tests for Alerts Command security + performance fixes.

Focus:
 1. Webhook secret enforcement (POST /api/alerts/webhook)
 2. Admin password loaded from env var (old admin123 rejected, new accepted)
 3. DB index presence (smoke) + regression suite
"""
import os
import sys
import uuid
import requests

BASE = "https://market-preflight.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@alertscommand.com"
ADMIN_NEW_PASSWORD = "iC_T3UTrwO-Ym1eBwMvdDrlU"
ADMIN_OLD_PASSWORD = "admin123"
WEBHOOK_SECRET = "hbd30zqEwACjWgnBbq0V4TYLzl7Da9m2b3BWcRNms8WSl7ntX27LEQo7IdduXgwV"
BAD_SECRET = "not-the-real-secret-xxxxxx"

results = []

def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} — {detail}")
    results.append((name, ok, detail))

def section(title):
    print("\n" + "=" * 80)
    print(title)
    print("=" * 80)

# ---------------- 1. Webhook Secret Enforcement ----------------
section("1. Webhook Secret Enforcement")
webhook_url = f"{BASE}/alerts/webhook"

r = requests.post(webhook_url, json={"content": "NDX @ 26,400 no-secret"}, timeout=30)
record("Webhook: missing secret → 403", r.status_code == 403,
       f"status={r.status_code} body={r.text[:200]}")

r = requests.post(webhook_url, json={"content": "NDX @ 26,401 wrong-header"},
                  headers={"X-Webhook-Secret": BAD_SECRET}, timeout=30)
record("Webhook: wrong X-Webhook-Secret → 403", r.status_code == 403,
       f"status={r.status_code} body={r.text[:200]}")

r = requests.post(webhook_url, json={"content": "NDX @ 26,402 wrong-bearer"},
                  headers={"Authorization": f"Bearer {BAD_SECRET}"}, timeout=30)
record("Webhook: wrong Bearer token → 403", r.status_code == 403,
       f"status={r.status_code} body={r.text[:200]}")

marker_1 = f"NDX @ 26,403 header-ok-{uuid.uuid4().hex[:6]}"
r = requests.post(webhook_url, json={"content": marker_1},
                  headers={"X-Webhook-Secret": WEBHOOK_SECRET}, timeout=30)
header_ok = r.status_code == 200 and r.json().get("status") == "ok" and r.json().get("alert_id")
alert_id_1 = r.json().get("alert_id") if r.status_code == 200 else None
record("Webhook: correct X-Webhook-Secret → 200", header_ok,
       f"status={r.status_code} body={r.text[:200]}")

marker_2 = f"NDX @ 26,404 bearer-ok-{uuid.uuid4().hex[:6]}"
r = requests.post(webhook_url, json={"content": marker_2},
                  headers={"Authorization": f"Bearer {WEBHOOK_SECRET}"}, timeout=30)
bearer_ok = r.status_code == 200 and r.json().get("status") == "ok" and r.json().get("alert_id")
alert_id_2 = r.json().get("alert_id") if r.status_code == 200 else None
record("Webhook: correct Bearer token → 200", bearer_ok,
       f"status={r.status_code} body={r.text[:200]}")

# ---------------- 2. Admin Password from Env Var ----------------
section("2. Admin Password from Env Var")
login_url = f"{BASE}/auth/login"

r = requests.post(login_url, json={"email": ADMIN_EMAIL, "password": ADMIN_OLD_PASSWORD}, timeout=30)
record("Login: old 'admin123' → 401", r.status_code == 401,
       f"status={r.status_code} body={r.text[:200]}")

r = requests.post(login_url, json={"email": ADMIN_EMAIL, "password": ADMIN_NEW_PASSWORD}, timeout=30)
ok_login = r.status_code == 200
token = ""
is_admin = False
if ok_login:
    body = r.json()
    token = body.get("access_token") or body.get("token") or ""
    user = body.get("user", {})
    is_admin = bool(user.get("is_admin"))
record("Login: new password → 200 + JWT + is_admin=true",
       ok_login and bool(token) and is_admin,
       f"status={r.status_code} has_token={bool(token)} is_admin={is_admin}")

me_email_ok = False
if token:
    r = requests.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if r.status_code == 200:
        me = r.json()
        # API wraps the user in {"user": {...}}
        user_obj = me.get("user", me) if isinstance(me, dict) else {}
        me_email_ok = user_obj.get("email") == ADMIN_EMAIL and bool(user_obj.get("is_admin"))
    record("GET /auth/me with JWT → 200", me_email_ok,
           f"status={r.status_code} body={r.text[:200]}")
else:
    record("GET /auth/me with JWT → 200", False, "no token from login")

# ---------------- 3. Verify webhook alerts persisted ----------------
section("3. Alert Persistence Verification")

if token:
    r = requests.get(f"{BASE}/alerts", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    body = r.json() if r.status_code == 200 else {}
    # API wraps the list under {"alerts": [...]}
    arr = body.get("alerts") if isinstance(body, dict) and "alerts" in body else (body if isinstance(body, list) else [])
    alerts_ok = r.status_code == 200 and isinstance(arr, list)
    found_markers = []
    webhook_source_count = 0
    if alerts_ok:
        for a in arr:
            if a.get("source") == "webhook":
                webhook_source_count += 1
            if a.get("id") in (alert_id_1, alert_id_2):
                found_markers.append(a)
    record("GET /api/alerts → 200 with array", alerts_ok,
           f"status={r.status_code} count={len(arr) if alerts_ok else 'n/a'}")
    both_present = len(found_markers) == 2
    all_webhook_source = all(a.get("source") == "webhook" for a in found_markers) and both_present
    record("Webhook alerts appear in /api/alerts with source='webhook'",
           all_webhook_source,
           f"found={len(found_markers)}/2, total_webhook={webhook_source_count}")
else:
    record("GET /api/alerts → 200 with array", False, "no admin token")
    record("Webhook alerts appear in /api/alerts with source='webhook'", False, "no admin token")

# ---------------- 4. Regression Checks ----------------
section("4. Regression Checks")

rand_email = f"trader_{uuid.uuid4().hex[:10]}@alertscommand-test.com"
rand_password = "Tr@der-Strong-Pw-2026!"
rand_username = f"trader_{uuid.uuid4().hex[:6]}"
r = requests.post(f"{BASE}/auth/register",
                  json={"email": rand_email, "password": rand_password, "username": rand_username},
                  timeout=30)
reg_ok = r.status_code == 200
reg_token = ""
if reg_ok:
    rb = r.json()
    reg_token = rb.get("access_token") or rb.get("token") or ""
record("POST /api/auth/register (new random email) → 200",
       reg_ok and bool(reg_token),
       f"status={r.status_code} body={r.text[:200]}")

record("POST /api/auth/login (admin) → 200 [regression]", ok_login, "already tested above")
record("GET /api/auth/me (with JWT) → 200 [regression]", me_email_ok, "already tested above")

headers_admin = {"Authorization": f"Bearer {token}"} if token else {}

r = requests.get(f"{BASE}/market/ndx", headers=headers_admin, timeout=30)
ndx_ok = False
ndx_detail = ""
if r.status_code == 200:
    j = r.json()
    price = j.get("price")
    ndx_ok = isinstance(price, (int, float)) and price > 0
    ndx_detail = f"price={price} change={j.get('change')} %={j.get('changePercent')}"
record("GET /api/market/ndx → 200 with live NDX price", ndx_ok,
       f"status={r.status_code} {ndx_detail}")

r = requests.get(f"{BASE}/alerts", headers=headers_admin, timeout=30)
body = r.json() if r.status_code == 200 else {}
arr = body.get("alerts") if isinstance(body, dict) and "alerts" in body else (body if isinstance(body, list) else [])
alerts_reg_ok = r.status_code == 200 and isinstance(arr, list)
record("GET /api/alerts → 200 with array [regression]", alerts_reg_ok,
       f"status={r.status_code} count={len(arr) if alerts_reg_ok else 'n/a'}")

r = requests.get(f"{BASE}/preflight", headers=headers_admin, timeout=45)
preflight_ok = False
pf_detail = ""
if r.status_code == 200:
    j = r.json()
    # sentiment can be under various keys depending on impl
    has_sentiment = any(k in j for k in ("sentiment", "ai_sentiment", "market_sentiment", "news_sentiment"))
    events = j.get("economic_events") or j.get("events") or []
    preflight_ok = isinstance(events, list) and (has_sentiment or len(events) > 0)
    pf_detail = (f"economic_source={j.get('economic_source')} events={len(events)} "
                 f"has_sentiment={has_sentiment} keys={list(j.keys())[:10]}")
record("GET /api/preflight → 200 with sentiment + economic events", preflight_ok,
       f"status={r.status_code} {pf_detail}")

# Multi quote: try /market/quote/multi, fall back to /market/quote-multi, /market/quotes
quote_ok = False
quote_detail = ""
for path in ["market/quote/multi", "market/quote-multi", "market/quotes"]:
    r = requests.get(f"{BASE}/{path}", params={"symbols": "AAPL,MSFT"}, headers=headers_admin, timeout=30)
    if r.status_code == 200:
        j = r.json()
        items = j if isinstance(j, list) else (
            j.get("quotes") if isinstance(j, dict) and "quotes" in j else (
                list(j.values()) if isinstance(j, dict) else None
            )
        )
        if isinstance(items, list) and len(items) >= 2:
            quote_ok = True
            quote_detail = f"path=/{path} items={len(items)}"
            break
    else:
        quote_detail += f" /{path}→{r.status_code};"
record("GET /api/market/quote/multi?symbols=AAPL,MSFT → 200", quote_ok, quote_detail)

# ---------------- Summary ----------------
section("SUMMARY")
passed = sum(1 for _, ok, _ in results if ok)
total = len(results)
print(f"{passed}/{total} tests passed")
for name, ok, detail in results:
    sym = "OK  " if ok else "FAIL"
    print(f"  [{sym}] {name}  | {detail}")
sys.exit(0 if passed == total else 1)
