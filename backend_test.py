"""Backend tests for Alerts Command - focusing on economic calendar integration on /api/preflight."""
import os
import sys
import time
import uuid
import json
import requests

BASE_URL = "https://trading-signals-269.preview.emergentagent.com/api"

ADMIN_EMAIL = "admin@alertscommand.com"
ADMIN_PASSWORD = "admin123"

results = []

def record(name, ok, details=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}: {details}")
    results.append((name, ok, details))
    return ok


def test_preflight_live():
    """1. /api/preflight returns live economic events with actual/forecast/previous"""
    print("\n=== TEST 1: /api/preflight (first call) ===")
    try:
        r = requests.get(f"{BASE_URL}/preflight", timeout=30)
    except Exception as e:
        return record("preflight_http_200", False, f"Request error: {e}")
    if r.status_code != 200:
        return record("preflight_http_200", False, f"Status={r.status_code}, body={r.text[:300]}")
    record("preflight_http_200", True, f"HTTP 200")
    data = r.json()

    econ_source = data.get("economic_source")
    record(
        "economic_source_live",
        econ_source == "live",
        f"economic_source={econ_source!r} (expected 'live')",
    )

    events = data.get("economic_events", [])
    record(
        "at_least_5_events",
        len(events) >= 5,
        f"len(economic_events)={len(events)}",
    )

    required_fields = ["event", "date", "impact", "category", "estimate", "previous", "actual"]
    missing_sample = None
    all_have_fields = True
    for e in events:
        for f in required_fields:
            if f not in e:
                all_have_fields = False
                missing_sample = (f, e)
                break
        if not all_have_fields:
            break
    record(
        "events_have_required_fields",
        all_have_fields,
        "All events have required fields" if all_have_fields else f"Missing {missing_sample[0]!r} in event {missing_sample[1]}",
    )

    with_actual = [e for e in events if (e.get("actual") or "").strip()]
    sample_actuals = [(e["event"], e["actual"]) for e in with_actual[:3]]
    record(
        "at_least_one_actual_nonempty",
        len(with_actual) >= 1,
        f"{len(with_actual)} events have non-empty 'actual'. Samples: {sample_actuals}",
    )

    if events:
        print(f"   Sample event: {json.dumps(events[0], indent=2)[:500]}")
    return True


def test_preflight_cache_hit():
    """2. Second call → backend logs should show CACHE HIT"""
    print("\n=== TEST 2: /api/preflight (second call → cache hit) ===")
    time.sleep(1)
    try:
        r = requests.get(f"{BASE_URL}/preflight", timeout=30)
    except Exception as e:
        return record("preflight_second_call", False, f"Request error: {e}")
    record("preflight_second_call", r.status_code == 200, f"Status={r.status_code}")

    time.sleep(1)
    cache_hit_found = False
    details = ""
    try:
        import subprocess
        out = subprocess.check_output(
            ["tail", "-n", "400", "/var/log/supervisor/backend.err.log"],
            stderr=subprocess.STDOUT,
        ).decode("utf-8", errors="ignore")
        cache_hit_found = "Econ calendar: CACHE HIT" in out
        fetched_count = out.count("Econ calendar: FETCHED")
        cache_hit_count = out.count("Econ calendar: CACHE HIT")
        details = f"CACHE HIT lines: {cache_hit_count}, FETCHED lines: {fetched_count}"
    except Exception as e:
        details = f"Could not read log: {e}"
    record("cache_hit_log_present", cache_hit_found, details)


def test_auth_register():
    print("\n=== TEST 3a: /api/auth/register ===")
    unique_email = f"trader_{uuid.uuid4().hex[:8]}@alertscommand.com"
    payload = {
        "email": unique_email,
        "username": f"trader_{uuid.uuid4().hex[:6]}",
        "password": "SecurePass2026!",
    }
    try:
        r = requests.post(f"{BASE_URL}/auth/register", json=payload, timeout=15)
    except Exception as e:
        return record("auth_register", False, f"Request error: {e}")
    ok = r.status_code == 200 and "token" in r.json() and "user" in r.json()
    record("auth_register", ok, f"Status={r.status_code}, email={unique_email}")


def test_auth_login():
    print("\n=== TEST 3b: /api/auth/login (admin) ===")
    payload = {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    try:
        r = requests.post(f"{BASE_URL}/auth/login", json=payload, timeout=15)
    except Exception as e:
        record("auth_login", False, f"Request error: {e}")
        return None
    if r.status_code != 200:
        record("auth_login", False, f"Status={r.status_code}, body={r.text[:300]}")
        return None
    data = r.json()
    token = data.get("token")
    record(
        "auth_login",
        bool(token) and data.get("user", {}).get("is_admin") is True,
        f"JWT received, is_admin={data.get('user', {}).get('is_admin')}",
    )
    return token


def test_market_ndx():
    print("\n=== TEST 3c: /api/market/ndx ===")
    try:
        r = requests.get(f"{BASE_URL}/market/ndx", timeout=20)
    except Exception as e:
        return record("market_ndx", False, f"Request error: {e}")
    if r.status_code != 200:
        return record("market_ndx", False, f"Status={r.status_code}")
    data = r.json()
    required = ["symbol", "price", "change", "changePercent", "timestamp"]
    missing = [f for f in required if f not in data]
    ok = not missing and data.get("symbol") == "NDX"
    record(
        "market_ndx",
        ok,
        f"NDX @ ${data.get('price')} ({data.get('changePercent')}%), missing={missing}",
    )


def test_alerts_list():
    print("\n=== TEST 3d: /api/alerts ===")
    try:
        r = requests.get(f"{BASE_URL}/alerts", timeout=15)
    except Exception as e:
        return record("alerts_list", False, f"Request error: {e}")
    if r.status_code != 200:
        return record("alerts_list", False, f"Status={r.status_code}")
    data = r.json()
    ok = "alerts" in data and isinstance(data["alerts"], list)
    record("alerts_list", ok, f"Retrieved {len(data.get('alerts', []))} alerts")


def test_webhook_alert():
    print("\n=== TEST 3e: /api/alerts/webhook ===")
    payload = {"content": "NDX @ 26,400 test"}
    try:
        r = requests.post(f"{BASE_URL}/alerts/webhook", json=payload, timeout=15)
    except Exception as e:
        return record("alerts_webhook", False, f"Request error: {e}")
    if r.status_code != 200:
        return record("alerts_webhook", False, f"Status={r.status_code}, body={r.text[:300]}")
    data = r.json()
    ok = data.get("status") == "ok" and data.get("alert_id")
    record("alerts_webhook", ok, f"alert_id={data.get('alert_id')}")

    time.sleep(0.5)
    try:
        r2 = requests.get(f"{BASE_URL}/alerts", timeout=15)
        alerts = r2.json().get("alerts", [])
        found = any(a.get("id") == data.get("alert_id") for a in alerts)
        record("alerts_webhook_verified_in_list", found, f"Alert found in /alerts: {found}")
    except Exception as e:
        record("alerts_webhook_verified_in_list", False, f"Verification error: {e}")


def main():
    print(f"=== Alerts Command Backend Tests ===")
    print(f"BASE_URL: {BASE_URL}\n")

    test_preflight_live()
    test_preflight_cache_hit()
    test_auth_register()
    test_auth_login()
    test_market_ndx()
    test_alerts_list()
    test_webhook_alert()

    print("\n=== SUMMARY ===")
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    for name, ok, details in results:
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name}")
    print(f"\n{passed}/{total} checks passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
