"""Backend performance + regression tests for Alerts Command.

Focuses on:
  (1) GET /api/preflight  — parallelization + caching
  (2) GET /api/ai/sentiment — stale-while-revalidate + 15s hard timeout
  (3) Regression — auth, market/ndx, alerts, webhook secret enforcement
"""
import time
import uuid
import requests

BASE_URL = "https://market-preflight.preview.emergentagent.com/api"

ADMIN_EMAIL = "admin@alertscommand.com"
ADMIN_PASSWORD = "iC_T3UTrwO-Ym1eBwMvdDrlU"
WEBHOOK_SECRET = "hbd30zqEwACjWgnBbq0V4TYLzl7Da9m2b3BWcRNms8WSl7ntX27LEQo7IdduXgwV"

results = []

def record(name, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    line = f"[{status}] {name} :: {detail}"
    print(line)
    results.append({"name": name, "ok": ok, "detail": detail})
    return ok

def section(title):
    print("\n" + "=" * 80)
    print(f"  {title}")
    print("=" * 80)

# ============================================================
# 1. PREFLIGHT PERFORMANCE
# ============================================================
def test_preflight():
    section("1. GET /api/preflight - cold + warm timing")

    # Cold call
    t0 = time.time()
    try:
        r1 = requests.get(f"{BASE_URL}/preflight", timeout=30)
    except Exception as e:
        record("preflight cold call returns 200", False, f"request error: {e}")
        return
    t_cold = time.time() - t0
    record(
        "preflight cold call returns 200",
        r1.status_code == 200,
        f"status={r1.status_code} time={t_cold:.3f}s",
    )
    if r1.status_code != 200:
        print("  body:", r1.text[:400])
        return

    data1 = r1.json()
    required = ["economic_events", "economic_source", "earnings", "breaking_news", "date"]
    missing = [k for k in required if k not in data1]
    record(
        "preflight response has all required keys",
        not missing,
        f"keys={list(data1.keys())} missing={missing}",
    )

    record(
        "preflight cold call < 6s (target <2s; soft ceiling <6s)",
        t_cold < 6.0,
        f"cold={t_cold:.3f}s",
    )

    econ_source = data1.get("economic_source")
    record(
        "economic_source == 'live'",
        econ_source == "live",
        f"economic_source={econ_source}",
    )

    ev_count = len(data1.get("economic_events", []))
    record(
        "economic_events populated (>=1)",
        ev_count >= 1,
        f"count={ev_count} (expected ~19 US events)",
    )

    bn = data1.get("breaking_news", [])
    record(
        "breaking_news has ~10 items (5-15)",
        5 <= len(bn) <= 15,
        f"breaking_news count={len(bn)}",
    )
    if bn:
        first = bn[0]
        has_fields = all(k in first for k in ("headline", "source", "sentiment"))
        record(
            "breaking_news items have headline/source/sentiment",
            has_fields,
            f"first_item_keys={list(first.keys())}",
        )

    # Warm call
    t0 = time.time()
    r2 = requests.get(f"{BASE_URL}/preflight", timeout=15)
    t_warm = time.time() - t0
    record(
        "preflight warm call returns 200",
        r2.status_code == 200,
        f"status={r2.status_code} time={t_warm:.3f}s",
    )
    record(
        "preflight warm call < 500ms",
        t_warm < 0.5,
        f"warm={t_warm:.3f}s (target <500ms, ideally <100ms)",
    )

    speedup = t_cold / t_warm if t_warm > 0 else float("inf")
    record(
        "warm meaningfully faster than cold (>=2x OR warm<0.3s)",
        speedup >= 2.0 or t_warm < 0.3,
        f"speedup={speedup:.1f}x cold={t_cold:.3f}s warm={t_warm:.3f}s",
    )

# ============================================================
# 2. AI SENTIMENT
# ============================================================
def test_ai_sentiment():
    section("2. GET /api/ai/sentiment - cold + warm timing, 15s hard timeout")

    t0 = time.time()
    try:
        r1 = requests.get(f"{BASE_URL}/ai/sentiment", timeout=45)
    except Exception as e:
        record("ai/sentiment cold call completes", False, f"request error: {e}")
        return
    t_cold = time.time() - t0

    record(
        "ai/sentiment cold call returns 200",
        r1.status_code == 200,
        f"status={r1.status_code} time={t_cold:.3f}s",
    )

    record(
        "ai/sentiment cold call completes within 25s (hard-timeout fix)",
        t_cold < 25.0,
        f"cold_time={t_cold:.3f}s (was 3+ min pre-fix; target <=20s worst case)",
    )

    if r1.status_code != 200:
        print("  body:", r1.text[:400])
        return

    data1 = r1.json()
    sentiment = data1.get("sentiment")
    record(
        "ai/sentiment response has sentiment object",
        sentiment is not None,
        f"has_sentiment={sentiment is not None} error={data1.get('error')}",
    )

    is_fallback = False
    if sentiment:
        overall = sentiment.get("overall_sentiment")
        confidence = sentiment.get("confidence")
        summary = sentiment.get("summary", "") or ""
        record(
            "sentiment.overall_sentiment is bullish/bearish/neutral",
            overall in ("bullish", "bearish", "neutral"),
            f"overall_sentiment={overall}",
        )
        record(
            "sentiment.confidence is 0-10",
            isinstance(confidence, (int, float)) and 0 <= confidence <= 10,
            f"confidence={confidence}",
        )
        is_fallback = confidence == 0 and "unavailable" in summary.lower()
        if is_fallback:
            print(f"  [info] FALLBACK sentiment (Claude down): summary='{summary[:120]}'")
        else:
            print(f"  [info] Claude succeeded, overall={overall}, confidence={confidence}")

    shape_keys = ("sentiment", "generated_at", "ndx_price", "ndx_change", "news_count")
    present = [k for k in shape_keys if k in data1]
    record(
        "ai/sentiment response has expected shape keys (at least 2)",
        len(present) >= 2,
        f"keys_present={present}",
    )

    # Warm
    time.sleep(0.5)
    t0 = time.time()
    r2 = requests.get(f"{BASE_URL}/ai/sentiment", timeout=45)
    t_warm = time.time() - t0
    record(
        "ai/sentiment warm call returns 200",
        r2.status_code == 200,
        f"status={r2.status_code} time={t_warm:.3f}s",
    )

    data2 = r2.json() if r2.status_code == 200 else {}
    s2 = data2.get("sentiment", {}) or {}
    is_fallback2 = s2.get("confidence") == 0 and "unavailable" in (s2.get("summary", "") or "").lower()

    if is_fallback2:
        record(
            "ai/sentiment warm timing (Claude unavailable; can't cache)",
            t_warm < 25.0,
            f"warm={t_warm:.3f}s (Claude down -> no cache; still capped at <25s)",
        )
    else:
        record(
            "ai/sentiment warm call < 500ms (cache hit)",
            t_warm < 0.5,
            f"warm={t_warm:.3f}s (target <500ms)",
        )


# ============================================================
# 3. REGRESSION
# ============================================================
def test_regression():
    section("3. Regression - auth/market/alerts/webhook")

    unique = uuid.uuid4().hex[:8]
    reg_payload = {
        "email": f"trader_{unique}@alertscommand.test",
        "username": f"trader_{unique}",
        "password": "Str0ng!Pass_2026",
    }
    r = requests.post(f"{BASE_URL}/auth/register", json=reg_payload, timeout=15)
    try:
        body = r.json()
    except Exception:
        body = {}
    ok = r.status_code == 200 and "token" in body
    record(
        "POST /api/auth/register -> 200 + token",
        ok,
        f"status={r.status_code} keys={list(body.keys()) if ok else r.text[:120]}",
    )

    r = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    admin_token = None
    if r.status_code == 200:
        body = r.json()
        admin_token = body.get("token")
        is_admin = body.get("user", {}).get("is_admin")
        record(
            "POST /api/auth/login (admin) -> 200 + JWT + is_admin=true",
            bool(admin_token) and is_admin is True,
            f"has_token={bool(admin_token)} is_admin={is_admin}",
        )
    else:
        record(
            "POST /api/auth/login (admin) -> 200",
            False,
            f"status={r.status_code} body={r.text[:200]}",
        )

    if admin_token:
        r = requests.get(
            f"{BASE_URL}/auth/me",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        body = r.json() if r.status_code == 200 else {}
        u = body.get("user", {}) if isinstance(body, dict) else {}
        record(
            "GET /api/auth/me with JWT -> 200 + admin user",
            r.status_code == 200 and u.get("email") == ADMIN_EMAIL,
            f"status={r.status_code} email={u.get('email')}",
        )

    r = requests.get(f"{BASE_URL}/market/ndx", timeout=20)
    if r.status_code == 200:
        q = r.json()
        record(
            "GET /api/market/ndx -> 200 with live NDX",
            q.get("symbol") == "NDX" and q.get("price", 0) > 0,
            f"price={q.get('price')} change={q.get('change')} changePct={q.get('changePercent')}",
        )
    else:
        record(
            "GET /api/market/ndx -> 200",
            False,
            f"status={r.status_code} body={r.text[:200]}",
        )

    r = requests.get(f"{BASE_URL}/alerts", timeout=15)
    if r.status_code == 200:
        body = r.json()
        alerts = body.get("alerts", [])
        record(
            "GET /api/alerts -> 200 with alerts array",
            isinstance(alerts, list),
            f"status={r.status_code} count={len(alerts)}",
        )
    else:
        record("GET /api/alerts -> 200", False, f"status={r.status_code}")

    r = requests.post(
        f"{BASE_URL}/alerts/webhook",
        json={"content": "NDX @ 26,500.25 - regression test"},
        headers={"X-Webhook-Secret": WEBHOOK_SECRET},
        timeout=15,
    )
    try:
        body = r.json()
    except Exception:
        body = {}
    record(
        "POST /api/alerts/webhook with correct X-Webhook-Secret -> 200",
        r.status_code == 200 and "alert_id" in body,
        f"status={r.status_code} body={str(body)[:200]}",
    )

    r = requests.post(
        f"{BASE_URL}/alerts/webhook",
        json={"content": "NDX @ 26,500.25 - unauthorized"},
        timeout=15,
    )
    record(
        "POST /api/alerts/webhook WITHOUT secret -> 403",
        r.status_code == 403,
        f"status={r.status_code} body={r.text[:150]}",
    )


def main():
    test_preflight()
    test_ai_sentiment()
    test_regression()

    section("SUMMARY")
    passed = sum(1 for x in results if x["ok"])
    total = len(results)
    print(f"PASSED: {passed}/{total}")
    for r in results:
        mark = "PASS" if r["ok"] else "FAIL"
        print(f"  [{mark}] {r['name']}")
        if not r["ok"]:
            print(f"         -> {r['detail']}")

    return passed, total


if __name__ == "__main__":
    p, t = main()
    exit(0 if p == t else 1)
