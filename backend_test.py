"""
Backend tests for the Midas module on Alerts Command.
Runs against the external preview URL.
"""
import sys
import requests

BACKEND_URL = "https://alert-refresh.preview.emergentagent.com/api"
ADMIN_EMAIL = "gregrussell90@gmail.com"
ADMIN_PASSWORD = "Liltony2026"
WEBHOOK_SECRET = "hbd30zqEwACjWgnBbq0V4TYLzl7Da9m2b3BWcRNms8WSl7ntX27LEQo7IdduXgwV"

DISCORD_ID = "111222333"
DISPLAY_NAME = "Test Trader"

passes = []
fails = []


def record(name, ok, detail=""):
    if ok:
        passes.append(name)
        print(f"  PASS  {name}  {detail}")
    else:
        fails.append((name, detail))
        print(f"  FAIL  {name}  {detail}")


def hdr(s):
    print(f"\n=== {s} ===")


def main():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})

    hdr("A) Admin auth setup")
    r = s.post(f"{BACKEND_URL}/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "remember_me": True},
               timeout=20)
    record("1. POST /auth/login -> 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code != 200:
        print("FATAL:", r.text[:300])
        return False
    body = r.json()
    admin_token = body.get("token")
    admin_user_id = body.get("user", {}).get("id")
    is_admin = body.get("user", {}).get("is_admin")
    record("1b. token returned & is_admin=true", bool(admin_token) and is_admin is True, f"is_admin={is_admin}")
    admin_h = {"Authorization": f"Bearer {admin_token}"}
    bot_h = {"X-Midas-Key": WEBHOOK_SECRET}

    hdr("B) Bot-facing X-Midas-Key tests")

    r = s.post(f"{BACKEND_URL}/midas/members",
               json={"discord_id": DISCORD_ID, "display_name": DISPLAY_NAME, "action": "add"},
               timeout=15)
    record("2. POST /midas/members no header -> 403", r.status_code == 403, f"status={r.status_code}")

    r = s.post(f"{BACKEND_URL}/midas/members", headers=bot_h,
               json={"discord_id": DISCORD_ID, "display_name": DISPLAY_NAME, "action": "add"},
               timeout=15)
    ok = r.status_code == 200 and (r.json() or {}).get("status") == "added"
    record("3. POST /midas/members add -> 200 status='added'", ok,
           f"status={r.status_code} body={r.text[:160]}")

    trade_body = {
        "discord_id": DISCORD_ID,
        "underlying": "NDX",
        "price_at_alert": 26450.5,
        "short_strike": 26400,
        "long_strike": 26350,
        "contracts": 2,
        "limit_price": 5.00,
        "account_balance": 12000,
        "order_id": "abc123",
        "status": "filled",
        "timestamp": "2026-05-13T17:00:00Z",
    }
    r = s.post(f"{BACKEND_URL}/midas/trades", headers=bot_h, json=trade_body, timeout=15)
    ok = r.status_code == 200 and (r.json() or {}).get("status") == "logged"
    record("4. POST /midas/trades -> 200 status='logged'", ok,
           f"status={r.status_code} body={r.text[:200]}")

    r = s.get(f"{BACKEND_URL}/midas/subscribers", headers=bot_h, timeout=15)
    sub_ok = r.status_code == 200 and isinstance(r.json().get("subscribers"), list) and "count" in r.json()
    record("5a. GET /midas/subscribers -> 200 with {subscribers,count}", sub_ok, f"status={r.status_code}")
    if sub_ok:
        subs = r.json().get("subscribers", [])
        found = any(x.get("discord_id") == DISCORD_ID for x in subs)
        record("5b. Discord-only member NOT in subscribers list", not found,
               f"count={r.json().get('count')} discord_match={found}")

    hdr("C) End-user flow (admin bypasses gate)")
    s.post(f"{BACKEND_URL}/midas/disconnect", headers=admin_h, timeout=15)

    r = s.get(f"{BACKEND_URL}/midas/status", headers=admin_h, timeout=30)
    ok6 = r.status_code == 200
    record("6. GET /midas/status (admin) -> 200", ok6, f"status={r.status_code} body={r.text[:200]}")
    if ok6:
        st = r.json()
        record("6b. status payload has midas_enabled/connected keys",
               "midas_enabled" in st and "connected" in st,
               f"midas_enabled={st.get('midas_enabled')} connected={st.get('connected')}")

    r = s.post(f"{BACKEND_URL}/midas/connect", headers=admin_h,
               json={"client_secret": "test_secret_abcd", "refresh_token": "test_refresh_wxyz"},
               timeout=30)
    ok = r.status_code == 200 and (r.json() or {}).get("status") == "connected"
    record("7. POST /midas/connect -> 200 status='connected'", ok,
           f"status={r.status_code} body={r.text[:200]}")

    r = s.get(f"{BACKEND_URL}/midas/status", headers=admin_h, timeout=45)
    record("8. GET /midas/status (after connect) -> 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        st = r.json()
        record("8a. connected=true", st.get("connected") is True, f"connected={st.get('connected')}")
        record("8b. client_secret_mask = '••••••••abcd'",
               st.get("client_secret_mask") == "••••••••abcd",
               f"mask={st.get('client_secret_mask')!r}")
        record("8c. refresh_token_mask = '••••••••wxyz'",
               st.get("refresh_token_mask") == "••••••••wxyz",
               f"mask={st.get('refresh_token_mask')!r}")
        bal = st.get("account_balance")
        record("8d. account_balance None or 0 (fake creds)", bal in (None, 0, 0.0),
               f"balance={bal!r}")
        record("8e. contracts == 1", st.get("contracts") == 1, f"contracts={st.get('contracts')}")
        record("8f. limit_price == 5.0", float(st.get("limit_price") or 0) == 5.0,
               f"limit_price={st.get('limit_price')}")
        record("8g. auto_trade == false", st.get("auto_trade") is False,
               f"auto_trade={st.get('auto_trade')}")

    r = s.post(f"{BACKEND_URL}/midas/settings", headers=admin_h,
               json={"auto_trade": True, "limit_price": 7.5}, timeout=15)
    record("9. POST /midas/settings (valid) -> 200", r.status_code == 200,
           f"status={r.status_code} body={r.text[:200]}")

    r = s.get(f"{BACKEND_URL}/midas/status", headers=admin_h, timeout=45)
    if r.status_code == 200:
        st = r.json()
        record("10a. auto_trade == true", st.get("auto_trade") is True, f"auto_trade={st.get('auto_trade')}")
        record("10b. limit_price == 7.5", float(st.get("limit_price") or 0) == 7.5,
               f"limit_price={st.get('limit_price')}")
    else:
        record("10. status fetch", False, f"status={r.status_code}")

    r = s.post(f"{BACKEND_URL}/midas/settings", headers=admin_h, json={"limit_price": 999}, timeout=15)
    record("11. POST /midas/settings limit_price=999 -> 400", r.status_code == 400,
           f"status={r.status_code} body={r.text[:200]}")

    r = s.get(f"{BACKEND_URL}/midas/trades", headers=admin_h, timeout=15)
    ok = r.status_code == 200 and isinstance(r.json().get("trades"), list)
    record("12. GET /midas/trades -> 200 with trades list", ok,
           f"status={r.status_code} count={len((r.json() or {}).get('trades', []))}")

    r = s.post(f"{BACKEND_URL}/midas/disconnect", headers=admin_h, timeout=15)
    record("13a. POST /midas/disconnect -> 200", r.status_code == 200,
           f"status={r.status_code} body={r.text[:200]}")
    r = s.get(f"{BACKEND_URL}/midas/status", headers=admin_h, timeout=15)
    record("13b. GET /midas/status after disconnect -> connected=false",
           r.status_code == 200 and r.json().get("connected") is False,
           f"status={r.status_code} connected={(r.json() or {}).get('connected')}")

    hdr("D) Admin endpoints")
    r = s.get(f"{BACKEND_URL}/admin/midas/users", headers=admin_h, timeout=15)
    ok = r.status_code == 200 and isinstance(r.json().get("users"), list)
    record("14a. GET /admin/midas/users -> 200", ok, f"status={r.status_code}")
    if ok:
        users = r.json().get("users", [])
        record("14b. users list non-empty", len(users) > 0, f"count={len(users)}")
        if users:
            keys_ok = all("midas_enabled" in u and "connected" in u and "auto_trade" in u for u in users)
            record("14c. each user has midas_enabled/connected/auto_trade keys", keys_ok, "")

    target_user_id = None
    r = s.get(f"{BACKEND_URL}/admin/users", headers=admin_h, timeout=15)
    if r.status_code == 200:
        users = r.json() if isinstance(r.json(), list) else r.json().get("users", [])
        for u in users:
            if not u.get("is_admin") and u.get("id") and u.get("id") != admin_user_id:
                target_user_id = u["id"]
                break
    if target_user_id:
        r = s.post(f"{BACKEND_URL}/admin/midas/toggle-access", headers=admin_h,
                   json={"user_id": target_user_id, "enabled": True}, timeout=15)
        record("15. POST /admin/midas/toggle-access -> 200", r.status_code == 200,
               f"status={r.status_code} body={r.text[:200]}")
    else:
        record("15. POST /admin/midas/toggle-access (no non-admin user)", False, "no candidate")

    hdr("E) Regression")
    r = s.get(f"{BACKEND_URL}/alerts", headers=admin_h, timeout=20)
    record("16. GET /alerts -> 200", r.status_code == 200, f"status={r.status_code}")

    r = s.get(f"{BACKEND_URL}/ai/sentiment", headers=admin_h, timeout=60)
    record("17. GET /ai/sentiment -> 200", r.status_code == 200, f"status={r.status_code}")

    r = s.post(f"{BACKEND_URL}/alerts/webhook",
               headers={"X-Webhook-Secret": WEBHOOK_SECRET},
               json={"content": "NDX bullish breakout @ 26500 (midas test)"}, timeout=20)
    record("18. POST /alerts/webhook -> 200", r.status_code == 200,
           f"status={r.status_code} body={r.text[:160]}")

    print("\n" + "=" * 60)
    print(f"PASSED: {len(passes)}  FAILED: {len(fails)}")
    if fails:
        print("\nFailures:")
        for n, d in fails:
            print(f"  - {n}: {d}")
    return len(fails) == 0


if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
