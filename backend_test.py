"""
Backend smoke + perf test for Launch-Subscription Optimization Pass.
Targets the external URL from EXPO_PUBLIC_BACKEND_URL + /api.
"""
import json
import time
import base64
import requests

BACKEND_URL = "https://alert-refresh.preview.emergentagent.com/api"
ADMIN_EMAIL = "gregrussell90@gmail.com"
ADMIN_PASS = "Liltony2026"
WEBHOOK_SECRET = "hbd30zqEwACjWgnBbq0V4TYLzl7Da9m2b3BWcRNms8WSl7ntX27LEQo7IdduXgwV"

PASS = []
FAIL = []


def record(name, ok, detail=""):
    (PASS if ok else FAIL).append((name, detail))
    icon = "PASS" if ok else "FAIL"
    print(f"[{icon}] {name} :: {detail}")


def has_timing_header(r):
    return "X-Response-Time-ms" in r.headers


def jwt_exp_days(token):
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload).decode())
        exp = data.get("exp")
        if not exp:
            return None
        return (exp - time.time()) / 86400.0
    except Exception:
        return None


def main():
    s = requests.Session()

    # 1. login (remember_me=true)
    t0 = time.time()
    r = s.post(f"{BACKEND_URL}/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASS, "remember_me": True},
               timeout=30)
    dur = (time.time() - t0) * 1000
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    token = body.get("token")
    days = jwt_exp_days(token) if token else None
    ok = r.status_code == 200 and token and has_timing_header(r) and days is not None and 85 <= days <= 95
    record("T1 POST /auth/login remember_me=true -> 200 + JWT ~90d + timing header",
           ok, f"status={r.status_code} time={dur:.0f}ms header={r.headers.get('X-Response-Time-ms')} jwt_exp_days={days}")

    headers = {"Authorization": f"Bearer {token}"} if token else {}

    # 2. /auth/me
    t0 = time.time()
    r = s.get(f"{BACKEND_URL}/auth/me", headers=headers, timeout=30)
    dur = (time.time() - t0) * 1000
    body = r.json() if r.status_code == 200 else {}
    ok = r.status_code == 200 and has_timing_header(r) and (("user" in body) or ("email" in body))
    record("T2 GET /auth/me -> 200 + user + timing header",
           ok, f"status={r.status_code} time={dur:.0f}ms header={r.headers.get('X-Response-Time-ms')} keys={list(body.keys())[:6]}")

    # 3. /ai/sentiment (real, non-placeholder)
    t0 = time.time()
    r = s.get(f"{BACKEND_URL}/ai/sentiment", headers=headers, timeout=60)
    dur1 = (time.time() - t0) * 1000
    j = r.json() if r.status_code == 200 else {}
    sent_block = j.get("sentiment") or {}
    summary = sent_block.get("summary", "") if isinstance(sent_block, dict) else ""
    placeholder_substrings = [
        "temporarily unavailable",
        "ai analysis is being prepared",
        "please try again",
        "being prepared",
    ]
    is_placeholder = any(p in summary.lower() for p in placeholder_substrings) or len(summary) < 30
    ok_summary = bool(summary) and not is_placeholder
    record("T3 GET /ai/sentiment -> 200 + real non-placeholder summary + timing header",
           r.status_code == 200 and has_timing_header(r) and ok_summary,
           f"status={r.status_code} time={dur1:.0f}ms header={r.headers.get('X-Response-Time-ms')} mode={j.get('mode')} summary_len={len(summary)} summary_preview='{summary[:100]}'")

    # 4. second call (cache hit, faster or equal)
    t0 = time.time()
    r2 = s.get(f"{BACKEND_URL}/ai/sentiment", headers=headers, timeout=60)
    dur2 = (time.time() - t0) * 1000
    server_ms = int(r2.headers.get("X-Response-Time-ms", "9999") or 9999)
    record("T4 GET /ai/sentiment (2nd call) -> 200 cached & fast",
           r2.status_code == 200 and has_timing_header(r2) and server_ms < 1000,
           f"status={r2.status_code} wall={dur2:.0f}ms server={server_ms}ms (cold_wall={dur1:.0f}ms)")

    # 5. /alerts fast (<300ms target server-side)
    t0 = time.time()
    r = s.get(f"{BACKEND_URL}/alerts", headers=headers, timeout=30)
    dur = (time.time() - t0) * 1000
    server_ms = int(r.headers.get("X-Response-Time-ms", "9999") or 9999)
    ok_fast = r.status_code == 200 and server_ms < 300
    record("T5 GET /alerts -> 200 FAST (<300ms server-side)",
           ok_fast and has_timing_header(r),
           f"status={r.status_code} wall={dur:.0f}ms server={server_ms}ms")

    # 6. /preflight
    t0 = time.time()
    r = s.get(f"{BACKEND_URL}/preflight", headers=headers, timeout=30)
    dur = (time.time() - t0) * 1000
    record("T6 GET /preflight -> 200",
           r.status_code == 200 and has_timing_header(r),
           f"status={r.status_code} time={dur:.0f}ms header={r.headers.get('X-Response-Time-ms')}")

    # 7. /admin/stats
    r = s.get(f"{BACKEND_URL}/admin/stats", headers=headers, timeout=30)
    j = r.json() if r.status_code == 200 else {}
    nums_ok = all(isinstance(j.get(k), (int, float)) for k in ("users", "alerts", "messages"))
    record("T7 GET /admin/stats -> 200 with numeric users/alerts/messages",
           r.status_code == 200 and nums_ok and has_timing_header(r),
           f"status={r.status_code} users={j.get('users')} alerts={j.get('alerts')} messages={j.get('messages')}")

    # 8. /admin/users
    r = s.get(f"{BACKEND_URL}/admin/users", headers=headers, timeout=30)
    body = r.json() if r.status_code == 200 else {}
    users_list = body if isinstance(body, list) else (body.get("users", body) if isinstance(body, dict) else [])
    n = len(users_list) if isinstance(users_list, list) else None
    record("T8 GET /admin/users -> 200",
           r.status_code == 200 and has_timing_header(r) and isinstance(users_list, list),
           f"status={r.status_code} count={n}")

    # 9. Webhook with X-Webhook-Secret
    r = s.post(f"{BACKEND_URL}/alerts/webhook",
               headers={"X-Webhook-Secret": WEBHOOK_SECRET, "Content-Type": "application/json"},
               json={"content": "NDX bullish breakout @ 26500"}, timeout=30)
    j = r.json() if r.status_code == 200 else {}
    record("T9 POST /alerts/webhook (X-Webhook-Secret + NDX bullish) -> 200 + alert_id",
           r.status_code == 200 and has_timing_header(r) and "alert_id" in j,
           f"status={r.status_code} alert_id={j.get('alert_id')} header={r.headers.get('X-Response-Time-ms')}")

    print()
    print(f"PASSED: {len(PASS)}")
    print(f"FAILED: {len(FAIL)}")
    for n, d in FAIL:
        print(f"  FAIL {n} :: {d}")


if __name__ == "__main__":
    main()
