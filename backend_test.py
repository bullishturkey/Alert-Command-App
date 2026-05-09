"""
Backend test for push notification title formatting (emoji + ticker + type + price)
plus regression checks.
"""
import os
import sys
import time
import json
import requests
from datetime import datetime, timezone

BASE = "https://alert-refresh.preview.emergentagent.com/api"
ADMIN_EMAIL = "gregrussell90@gmail.com"
ADMIN_PASSWORD = "Liltony2026"
WEBHOOK_SECRET = "hbd30zqEwACjWgnBbq0V4TYLzl7Da9m2b3BWcRNms8WSl7ntX27LEQo7IdduXgwV"

results = []
def log(name, ok, info=""):
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}: {info}")
    results.append((name, ok, info))


def login_admin(remember_me=True):
    return requests.post(f"{BASE}/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
        "remember_me": remember_me,
    }, timeout=20)


def main():
    # ===== 1) Admin login (regression: remember_me=true) =====
    r = login_admin(remember_me=True)
    if r.status_code != 200:
        log("admin_login", False, f"HTTP {r.status_code} body={r.text[:200]}")
        sys.exit(1)
    body = r.json()
    token = body.get("token") or body.get("access_token")
    if not token:
        log("admin_login", False, f"no token in response: {body}")
        sys.exit(1)
    log("admin_login_remember_me", True, f"got JWT (len={len(token)})")
    headers = {"Authorization": f"Bearer {token}"}

    # JWT TTL check
    try:
        import base64
        parts = token.split(".")
        pad = "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + pad).decode())
        exp = payload.get("exp")
        iat = payload.get("iat") or payload.get("nbf")
        if exp and iat:
            ttl_days = (exp - iat) / 86400
            ok = 80 <= ttl_days <= 100
            log("jwt_remember_me_ttl", ok, f"ttl~{ttl_days:.1f}d (expected ~90)")
        elif exp:
            now_ts = time.time()
            ttl_days = (exp - now_ts) / 86400
            ok = 80 <= ttl_days <= 100
            log("jwt_remember_me_ttl", ok, f"ttl~{ttl_days:.1f}d (vs now)")
        else:
            log("jwt_remember_me_ttl", False, f"no exp in payload: {payload}")
    except Exception as e:
        log("jwt_remember_me_ttl", False, f"decode failed: {e}")

    # ===== 2) AI sentiment =====
    t0 = time.time()
    r = requests.get(f"{BASE}/ai/sentiment", headers=headers, timeout=40)
    dt = time.time() - t0
    if r.status_code != 200:
        log("ai_sentiment", False, f"HTTP {r.status_code}")
    else:
        j = r.json()
        gen = j.get("generated_at")
        ok_gen = bool(gen)
        log("ai_sentiment", ok_gen, f"generated_at={gen} mode={j.get('mode')} ({dt:.2f}s)")

    # ===== 3) GET /api/alerts =====
    r = requests.get(f"{BASE}/alerts", headers=headers, timeout=20)
    if r.status_code != 200:
        log("get_alerts", False, f"HTTP {r.status_code}")
    else:
        bj = r.json()
        baseline_alerts = bj.get("alerts") if isinstance(bj, dict) else bj
        log("get_alerts", True, f"count={len(baseline_alerts)}")

    # ===== 4) GET /api/preflight =====
    t0 = time.time()
    r = requests.get(f"{BASE}/preflight", headers=headers, timeout=30)
    if r.status_code != 200:
        log("preflight", False, f"HTTP {r.status_code}")
    else:
        log("preflight", True, f"keys={list(r.json().keys())} ({time.time()-t0:.2f}s)")

    # ===== 5) Webhook NO secret -> 403 =====
    r = requests.post(f"{BASE}/alerts/webhook", json={"content": "test no auth"}, timeout=15)
    log("webhook_no_secret_403", r.status_code == 403, f"HTTP {r.status_code}")

    # ===== 6) Webhook bullish =====
    payload = {"content": "NDX bullish breakout @ 26500"}
    r = requests.post(
        f"{BASE}/alerts/webhook", json=payload,
        headers={"X-Webhook-Secret": WEBHOOK_SECRET}, timeout=25,
    )
    if r.status_code != 200:
        log("webhook_bullish_200", False, f"HTTP {r.status_code} body={r.text[:200]}")
    else:
        bull_id = r.json().get("alert_id")
        log("webhook_bullish_200", True, f"alert_id={bull_id}")
        time.sleep(1)
        r2 = requests.get(f"{BASE}/alerts", headers=headers, timeout=15)
        alerts = r2.json().get("alerts", []) if isinstance(r2.json(), dict) else r2.json()
        match = next((a for a in alerts if a.get("id") == bull_id), None)
        if not match:
            log("webhook_bullish_verify", False, "alert not found in /alerts list")
        else:
            ok = (match.get("type") == "bullish"
                  and match.get("ticker") == "NDX"
                  and match.get("source") == "webhook")
            log("webhook_bullish_verify", ok,
                f"type={match.get('type')} ticker={match.get('ticker')} source={match.get('source')} price={match.get('price')}")

    # ===== 7) Webhook bearish =====
    payload = {"content": "SPY bearish breakdown 580.50"}
    r = requests.post(
        f"{BASE}/alerts/webhook", json=payload,
        headers={"X-Webhook-Secret": WEBHOOK_SECRET}, timeout=25,
    )
    if r.status_code != 200:
        log("webhook_bearish_200", False, f"HTTP {r.status_code}")
    else:
        bear_id = r.json().get("alert_id")
        log("webhook_bearish_200", True, f"alert_id={bear_id}")
        time.sleep(1)
        r2 = requests.get(f"{BASE}/alerts", headers=headers, timeout=15)
        alerts = r2.json().get("alerts", []) if isinstance(r2.json(), dict) else r2.json()
        match = next((a for a in alerts if a.get("id") == bear_id), None)
        if not match:
            log("webhook_bearish_verify", False, "alert not found")
        else:
            ok_type = match.get("type") == "bearish"
            ok_src = match.get("source") == "webhook"
            log("webhook_bearish_verify", ok_type and ok_src,
                f"type={match.get('type')} ticker={match.get('ticker')} source={match.get('source')} price={match.get('price')}")

    # ===== 8) Webhook neutral signal =====
    payload = {"content": "Trade signal at 26450"}
    r = requests.post(
        f"{BASE}/alerts/webhook", json=payload,
        headers={"X-Webhook-Secret": WEBHOOK_SECRET}, timeout=25,
    )
    if r.status_code != 200:
        log("webhook_signal_200", False, f"HTTP {r.status_code}")
    else:
        sig_id = r.json().get("alert_id")
        log("webhook_signal_200", True, f"alert_id={sig_id}")
        time.sleep(1)
        r2 = requests.get(f"{BASE}/alerts", headers=headers, timeout=15)
        alerts = r2.json().get("alerts", []) if isinstance(r2.json(), dict) else r2.json()
        match = next((a for a in alerts if a.get("id") == sig_id), None)
        if not match:
            log("webhook_signal_verify", False, "alert not found")
        else:
            ok = match.get("type") == "signal"
            log("webhook_signal_verify", ok,
                f"type={match.get('type')} ticker={match.get('ticker')} source={match.get('source')} price={match.get('price')}")

    # ===== Summary =====
    print("\n" + "="*70)
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"PASSED {passed}/{total}")
    for name, ok, info in results:
        if not ok:
            print(f"  FAIL: {name} :: {info}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
