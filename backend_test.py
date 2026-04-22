"""Backend test for Alerts Command — new/changed endpoints.

Covers:
1. Guest-gated endpoints (preflight, alerts, ai/sentiment) now require auth.
2. /api/ai/sentiment `mode` field logic (live / daily_recap / weekly_recap).
3. Admin revoke / restore / delete flow.
4. Non-admin blocked from /admin/users.
5. Preflight performance + time_utc format.
"""
import os
import sys
import time
import json
import uuid
import re
import requests
from datetime import datetime, time as dt_time
from zoneinfo import ZoneInfo

BASE = "https://alerts-command.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@alertscommand.com"
ADMIN_PASS = "iC_T3UTrwO-Ym1eBwMvdDrlU"

results = []  # list of (name, ok, detail)


def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}: {detail}")
    results.append((name, ok, detail))


def expect_status(name, resp, allowed):
    ok = resp.status_code in allowed
    detail = f"status={resp.status_code} (allowed={allowed})"
    try:
        body = resp.json()
        if not ok:
            detail += f" body={json.dumps(body)[:300]}"
    except Exception:
        body = {}
        if not ok:
            detail += f" body={resp.text[:300]}"
    record(name, ok, detail)
    return ok, body


def admin_login():
    r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    if r.status_code != 200:
        record("admin_login", False, f"status={r.status_code} body={r.text[:200]}")
        sys.exit(1)
    tok = r.json()["token"]
    is_admin = r.json().get("user", {}).get("is_admin")
    record("admin_login", is_admin is True, f"is_admin={is_admin}")
    return tok


def compute_expected_mode():
    et = datetime.now(ZoneInfo("America/New_York"))
    if et.weekday() >= 5:
        return "weekly_recap"
    market_open = dt_time(9, 30)
    market_close = dt_time(16, 0)
    if market_open <= et.time() < market_close:
        return "live"
    return "daily_recap"


def test_guest_gated():
    print("\n=== 1. Guest-gated endpoints (no token → 401/403) ===")
    for path in ("/preflight", "/alerts", "/ai/sentiment"):
        r = requests.get(f"{BASE}{path}", timeout=30)
        expect_status(f"GET {path} (no token)", r, (401, 403))


def test_authed_endpoints(admin_token):
    print("\n=== 1b. Same endpoints with admin token → 200 ===")
    h = {"Authorization": f"Bearer {admin_token}"}
    for path in ("/preflight", "/alerts", "/ai/sentiment"):
        r = requests.get(f"{BASE}{path}", headers=h, timeout=60)
        expect_status(f"GET {path} (admin token)", r, (200,))


def test_sentiment_mode(admin_token):
    print("\n=== 2. /api/ai/sentiment mode field ===")
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{BASE}/ai/sentiment", headers=h, timeout=60)
    if r.status_code != 200:
        record("ai/sentiment mode check", False, f"non-200 status={r.status_code}")
        return
    body = r.json()
    mode = body.get("mode")
    expected = compute_expected_mode()
    ok = mode in ("live", "daily_recap", "weekly_recap")
    record("ai/sentiment mode field present & valid", ok, f"mode={mode!r}")
    record("ai/sentiment mode matches US/Eastern", mode == expected,
           f"expected={expected!r} actual={mode!r}")
    if mode == "daily_recap":
        dr = body.get("daily_recap") or {}
        record("daily_recap.date_key present",
               isinstance(dr.get("date_key"), str) and len(dr.get("date_key", "")) > 0,
               f"date_key={dr.get('date_key')!r}")
        record("daily_recap.date_label present", isinstance(dr.get("date_label"), str),
               f"date_label={dr.get('date_label')!r}")
        idx = dr.get("indexes")
        record("daily_recap.indexes is array", isinstance(idx, list),
               f"type={type(idx).__name__} len={len(idx) if isinstance(idx,list) else 'n/a'}")
    elif mode == "weekly_recap":
        wr = body.get("weekly_recap") or {}
        record("weekly_recap.week_key present",
               isinstance(wr.get("week_key"), str) and len(wr.get("week_key", "")) > 0,
               f"week_key={wr.get('week_key')!r}")
    elif mode == "live":
        record("live mode: sentiment payload present", body.get("sentiment") is not None,
               f"sentiment={'present' if body.get('sentiment') else 'missing'}")


def register_test_user(suffix):
    email = f"qa_{suffix}_{uuid.uuid4().hex[:8]}@alertscommand-test.com"
    password = "TestPass_" + uuid.uuid4().hex[:8]
    username = f"qa_{suffix}_{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{BASE}/auth/register",
                      json={"email": email, "password": password, "username": username},
                      timeout=15)
    if r.status_code != 200:
        record(f"register {suffix}", False, f"status={r.status_code} body={r.text[:200]}")
        return None
    data = r.json()
    record(f"register {suffix}", True, f"email={email} id={data['user']['id']}")
    return {"email": email, "password": password, "username": username,
            "id": data["user"]["id"], "token": data["token"]}


def test_admin_revoke_flow(admin_token):
    print("\n=== 3. Admin revoke/restore/delete flow ===")
    h_admin = {"Authorization": f"Bearer {admin_token}"}
    user = register_test_user("revoke")
    if not user:
        return
    uid = user["id"]

    r = requests.get(f"{BASE}/admin/users", headers=h_admin, timeout=15)
    ok, body = expect_status("GET /admin/users", r, (200,))
    if ok:
        users = body.get("users", [])
        match = next((u for u in users if u.get("id") == uid), None)
        if match:
            rev = match.get("is_revoked")
            record("new user is_revoked=false (or missing)", rev in (False, None),
                   f"is_revoked={rev!r}")
        else:
            record("new user appears in /admin/users", False,
                   f"uid={uid} not found in {len(users)} users")

    # Review says POST — code uses PUT. Try POST first; fall back to PUT.
    r_post = requests.post(f"{BASE}/admin/users/{uid}/revoke", headers=h_admin, timeout=15)
    if r_post.status_code == 200:
        record("POST /admin/users/{id}/revoke", True, "status=200")
    else:
        record("POST /admin/users/{id}/revoke",
               False,
               f"status={r_post.status_code} (code implements PUT; review spec asked POST)")
        r_put = requests.put(f"{BASE}/admin/users/{uid}/revoke", headers=h_admin, timeout=15)
        expect_status("PUT /admin/users/{id}/revoke (actual impl)", r_put, (200,))

    # Revoked user's existing token should be rejected by /preflight
    h_user = {"Authorization": f"Bearer {user['token']}"}
    r = requests.get(f"{BASE}/preflight", headers=h_user, timeout=30)
    expect_status("revoked user (old token) → GET /preflight blocked", r, (401, 403))

    # Also check fresh login path
    r_login = requests.post(f"{BASE}/auth/login",
                            json={"email": user["email"], "password": user["password"]},
                            timeout=15)
    if r_login.status_code == 200:
        fresh_tok = r_login.json()["token"]
        r_pf = requests.get(f"{BASE}/preflight",
                            headers={"Authorization": f"Bearer {fresh_tok}"}, timeout=30)
        expect_status("revoked user (fresh login token) → GET /preflight blocked",
                      r_pf, (401, 403))
    else:
        record("revoked user login rejected (alt path)",
               r_login.status_code in (401, 403),
               f"status={r_login.status_code}")

    # Restore
    r_post = requests.post(f"{BASE}/admin/users/{uid}/restore", headers=h_admin, timeout=15)
    if r_post.status_code == 200:
        record("POST /admin/users/{id}/restore", True, "status=200")
    else:
        record("POST /admin/users/{id}/restore",
               False,
               f"status={r_post.status_code} (code implements PUT; review spec asked POST)")
        r_put = requests.put(f"{BASE}/admin/users/{uid}/restore", headers=h_admin, timeout=15)
        expect_status("PUT /admin/users/{id}/restore (actual impl)", r_put, (200,))

    # Original token should work again
    r = requests.get(f"{BASE}/preflight", headers=h_user, timeout=30)
    expect_status("restored user → GET /preflight works", r, (200,))

    # Delete
    r = requests.delete(f"{BASE}/admin/users/{uid}", headers=h_admin, timeout=15)
    expect_status("DELETE /admin/users/{id}", r, (200,))

    r = requests.get(f"{BASE}/admin/users", headers=h_admin, timeout=15)
    if r.status_code == 200:
        users = r.json().get("users", [])
        gone = not any(u.get("id") == uid for u in users)
        record("deleted user absent from /admin/users", gone, f"uid={uid}")


def test_non_admin_blocked():
    print("\n=== 4. Non-admin user blocked from /admin/users ===")
    user = register_test_user("nonadmin")
    if not user:
        return None
    h = {"Authorization": f"Bearer {user['token']}"}
    r = requests.get(f"{BASE}/admin/users", headers=h, timeout=15)
    expect_status("non-admin → GET /admin/users", r, (403,))
    return user


def cleanup_user(admin_token, user):
    if not user:
        return
    h_admin = {"Authorization": f"Bearer {admin_token}"}
    try:
        requests.delete(f"{BASE}/admin/users/{user['id']}", headers=h_admin, timeout=10)
    except Exception:
        pass


def test_preflight_perf_and_format(admin_token):
    print("\n=== 5. Preflight perf & time_utc format ===")
    h = {"Authorization": f"Bearer {admin_token}"}
    t0 = time.time()
    r = requests.get(f"{BASE}/preflight", headers=h, timeout=20)
    dur = time.time() - t0
    ok = r.status_code == 200
    record("GET /preflight authed returns 200", ok, f"status={r.status_code} time={dur:.2f}s")
    record("preflight response < 8s", dur < 8.0, f"time={dur:.2f}s")
    if not ok:
        return
    body = r.json()
    events = body.get("economic_events") or []
    record("economic_events is non-empty array",
           isinstance(events, list) and len(events) > 0,
           f"count={len(events)}")
    pattern = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")
    iso_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
    samples = []
    matches = 0
    iso_only = 0
    none_or_empty = 0
    for e in events[:20]:
        tu = e.get("time_utc", "")
        samples.append(tu)
        if not tu:
            none_or_empty += 1
        elif pattern.match(tu):
            matches += 1
        elif iso_pattern.match(tu):
            iso_only += 1
    record(
        "time_utc format 'YYYY-MM-DD HH:MM:SS' (no trailing Z)",
        matches > 0 and iso_only == 0 and none_or_empty == 0,
        f"space_fmt={matches}/{min(len(events),20)} iso_T_fmt={iso_only} empty={none_or_empty} samples={samples[:3]}",
    )


def summarize():
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print("\n" + "=" * 60)
    print(f"SUMMARY: {passed}/{total} passed")
    print("=" * 60)
    fails = [(n, d) for n, ok, d in results if not ok]
    if fails:
        print("\nFAILURES:")
        for n, d in fails:
            print(f"  - {n}: {d}")
    return passed, total


def main():
    admin_token = admin_login()
    test_guest_gated()
    test_authed_endpoints(admin_token)
    test_sentiment_mode(admin_token)
    test_admin_revoke_flow(admin_token)
    nonadmin = test_non_admin_blocked()
    cleanup_user(admin_token, nonadmin)
    test_preflight_perf_and_format(admin_token)
    passed, total = summarize()
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
