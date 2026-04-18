"""
Alerts Command backend regression test for the NEW Weekend "Week in Review" feature.

Focus of this run:
 1. GET /api/ai/sentiment on a weekend returns mode=weekly_recap with populated
    weekly_recap (indexes, top_gainers, top_losers, key_news, week_key, week_label)
    and a sentiment block.
 2. Weekly cache: two back-to-back calls return identical payload (same generated_at),
    second call is fast (<500ms) — confirms ISO-week-level cache is working.
 3. Regression: /api/preflight (<2s), /api/auth/login (admin), /api/alerts/webhook
    with/without X-Webhook-Secret.

Runs against the external URL from frontend/.env (EXPO_PUBLIC_BACKEND_URL).
"""
import os
import re
import sys
import time
import json
import requests

# ---------------- Config ----------------
FRONTEND_ENV = "/app/frontend/.env"
BASE = None
with open(FRONTEND_ENV) as f:
    for line in f:
        m = re.match(r'^EXPO_PUBLIC_BACKEND_URL\s*=\s*"?([^"\n]+)"?', line.strip())
        if m:
            BASE = m.group(1).strip().strip('"')
            break
assert BASE, "EXPO_PUBLIC_BACKEND_URL not found in /app/frontend/.env"
API = BASE.rstrip('/') + '/api'
print(f"Base URL: {API}\n")

ADMIN_EMAIL = "admin@alertscommand.com"
ADMIN_PASSWORD = "iC_T3UTrwO-Ym1eBwMvdDrlU"
WEBHOOK_SECRET = "hbd30zqEwACjWgnBbq0V4TYLzl7Da9m2b3BWcRNms8WSl7ntX27LEQo7IdduXgwV"

PASSED = 0
FAILED = 0
FAILURES = []

def check(label, cond, detail=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  ✅ {label}")
    else:
        FAILED += 1
        FAILURES.append(f"{label} — {detail}")
        print(f"  ❌ {label}  ({detail})")


# ============================================================
# 1) WEEKEND WEEK-IN-REVIEW
# ============================================================
print("=" * 70)
print("[1] GET /api/ai/sentiment — weekend mode")
print("=" * 70)

t0 = time.time()
r1 = requests.get(f"{API}/ai/sentiment", timeout=90)
dt1 = time.time() - t0
print(f"  first call: HTTP {r1.status_code} in {dt1:.2f}s")
check("HTTP 200", r1.status_code == 200, f"body={r1.text[:300]}")

try:
    body1 = r1.json()
except Exception as e:
    print(f"  ❌ JSON decode error: {e}")
    sys.exit(1)

# Debug: print top-level keys
print(f"  top-level keys: {list(body1.keys())}")
if 'weekly_recap' in body1:
    wr = body1['weekly_recap']
    print(f"  weekly_recap keys: {list(wr.keys())}")
    print(f"  week_key={wr.get('week_key')}  week_label={wr.get('week_label')}")
    print(f"  #indexes={len(wr.get('indexes', []))}  #gainers={len(wr.get('top_gainers', []))}  #losers={len(wr.get('top_losers', []))}  #news={len(wr.get('key_news', []))}")

# Core shape checks
check("mode == 'weekly_recap'",
      body1.get('mode') == 'weekly_recap',
      f"got mode={body1.get('mode')!r}")

check("weekly_recap present",
      isinstance(body1.get('weekly_recap'), dict),
      "weekly_recap missing or not a dict")

wr = body1.get('weekly_recap') or {}

# week_key like 2026-W16
check("weekly_recap.week_key matches ISO '2026-Wxx'",
      bool(re.match(r"^\d{4}-W\d{2}$", str(wr.get('week_key', '')))),
      f"got {wr.get('week_key')!r}")

# week_label resembles 'Apr 13–19, 2026'
wl = str(wr.get('week_label', ''))
check("weekly_recap.week_label looks like 'Apr 13–19, 2026'",
      bool(re.search(r"[A-Z][a-z]{2}\s+\d+[–\-]\d+,\s*\d{4}", wl)) or
      bool(re.search(r"[A-Z][a-z]{2}\s+\d+\s*[–\-]\s*[A-Z][a-z]{2}\s+\d+,\s*\d{4}", wl)),
      f"got week_label={wl!r}")

# Indexes
indexes = wr.get('indexes') or []
check("weekly_recap.indexes has 5 entries",
      len(indexes) == 5,
      f"got {len(indexes)}")

expected_idx = {'NDX', 'GSPC', 'DJI', 'RUT', 'VIX'}
got_idx = {i.get('symbol') for i in indexes}
check(f"indexes contain NDX,GSPC,DJI,RUT,VIX",
      expected_idx.issubset(got_idx),
      f"got symbols={got_idx}")

for idx in indexes:
    sym = idx.get('symbol', '?')
    ok_shape = (
        isinstance(idx.get('symbol'), str) and
        isinstance(idx.get('name'), str) and
        isinstance(idx.get('change_pct'), (int, float)) and
        isinstance(idx.get('price'), (int, float)) and
        idx.get('price', 0) > 0
    )
    check(f"index {sym} has numeric change_pct + positive price",
          ok_shape,
          f"index={idx}")

# Top gainers
gainers = wr.get('top_gainers') or []
check("top_gainers length between 1 and 5",
      1 <= len(gainers) <= 5,
      f"got {len(gainers)}")

allowed_stock_syms = {'NVDA','MSFT','AAPL','AMZN','META','TSLA','AMD','AVGO','GOOGL','QQQ'}
gainer_syms = [g.get('symbol') for g in gainers]
check("top_gainers symbols are from tracked NDX-100 set",
      all(s in allowed_stock_syms for s in gainer_syms),
      f"got={gainer_syms}")

# descending sort
if gainers:
    pct_list = [g.get('change_pct', 0) for g in gainers]
    sorted_desc = sorted(pct_list, reverse=True)
    check("top_gainers sorted descending by change_pct",
          pct_list == sorted_desc,
          f"pcts={pct_list}")
    for g in gainers:
        check(f"gainer {g.get('symbol')} has price>0 and numeric change_pct",
              isinstance(g.get('change_pct'), (int, float)) and isinstance(g.get('price'), (int, float)) and g.get('price', 0) > 0,
              f"{g}")

# Top losers
losers = wr.get('top_losers') or []
check("top_losers length between 1 and 5",
      1 <= len(losers) <= 5,
      f"got {len(losers)}")

if losers:
    pct_list_l = [l.get('change_pct', 0) for l in losers]
    sorted_asc = sorted(pct_list_l)
    check("top_losers sorted ascending by change_pct (bottom 5 first)",
          pct_list_l == sorted_asc,
          f"pcts={pct_list_l}")

# Key news
key_news = wr.get('key_news') or []
check("key_news length between 0 and 10",
      0 <= len(key_news) <= 10,
      f"got {len(key_news)}")

if key_news:
    required = {'headline', 'source', 'sentiment', 'url', 'timestamp'}
    for i, n in enumerate(key_news[:3]):
        missing = required - set(n.keys())
        check(f"key_news[{i}] has headline/source/sentiment/url/timestamp",
              not missing,
              f"missing={missing} item={n}")

# sentiment block
s = body1.get('sentiment') or {}
check("sentiment block is a dict",
      isinstance(s, dict),
      f"got {type(s).__name__}")

# overall_sentiment may be fallback 'neutral' if Claude timed out — that's acceptable.
if isinstance(s, dict):
    os_val = s.get('overall_sentiment')
    check("sentiment.overall_sentiment in bullish/bearish/neutral",
          os_val in ('bullish', 'bearish', 'neutral'),
          f"got {os_val!r}")
    if s.get('summary') == 'Week in review summary unavailable.':
        print(f"  ℹ️  sentiment is fallback (Claude timed out upstream) — acceptable")
    else:
        print(f"  ℹ️  sentiment.overall_sentiment={os_val}, confidence={s.get('confidence')}")

# Top-level meta
check("generated_at is ISO string",
      isinstance(body1.get('generated_at'), str) and 'T' in body1.get('generated_at', ''),
      f"got {body1.get('generated_at')!r}")

# ndx_price / ndx_change — may be None if indexes empty
ndx_price = body1.get('ndx_price')
ndx_change = body1.get('ndx_change')
if ndx_price is not None:
    check("ndx_price is numeric and > 0",
          isinstance(ndx_price, (int, float)) and ndx_price > 0,
          f"got {ndx_price!r}")
if ndx_change is not None:
    check("ndx_change is numeric",
          isinstance(ndx_change, (int, float)),
          f"got {ndx_change!r}")

check("news_count is an int",
      isinstance(body1.get('news_count'), int),
      f"got {body1.get('news_count')!r}")


# ============================================================
# 2) WEEKLY CACHE BEHAVIOR
# ============================================================
print()
print("=" * 70)
print("[2] Weekly cache behaviour — call twice, expect identical + fast")
print("=" * 70)

t0 = time.time()
r2 = requests.get(f"{API}/ai/sentiment", timeout=30)
dt2 = time.time() - t0
print(f"  second call: HTTP {r2.status_code} in {dt2*1000:.1f} ms")

check("HTTP 200 on second call", r2.status_code == 200, r2.text[:200])
body2 = r2.json() if r2.ok else {}

check("second call < 500 ms (cache hit)",
      dt2 < 0.5,
      f"took {dt2*1000:.1f} ms")

check("second call mode == weekly_recap",
      body2.get('mode') == 'weekly_recap',
      f"got {body2.get('mode')!r}")

check("second call returns IDENTICAL generated_at",
      body1.get('generated_at') == body2.get('generated_at'),
      f"{body1.get('generated_at')} vs {body2.get('generated_at')}")

# Deep equality on weekly_recap payload confirms cache isn't regenerating
check("second call returns IDENTICAL weekly_recap payload",
      body1.get('weekly_recap') == body2.get('weekly_recap'),
      "weekly_recap payload changed between calls (cache miss?)")


# ============================================================
# 3) REGRESSION
# ============================================================
print()
print("=" * 70)
print("[3] Regression — preflight, admin login, webhook auth")
print("=" * 70)

# 3a. preflight
t0 = time.time()
r = requests.get(f"{API}/preflight", timeout=15)
dt = time.time() - t0
print(f"  /api/preflight: HTTP {r.status_code} in {dt:.2f}s")
check("preflight HTTP 200", r.status_code == 200, r.text[:200])
check("preflight < 2s", dt < 2.0, f"took {dt:.2f}s")
pf = r.json() if r.ok else {}
check("preflight.economic_events is a list",
      isinstance(pf.get('economic_events'), list),
      f"got {type(pf.get('economic_events')).__name__}")
check("preflight.earnings is a list",
      isinstance(pf.get('earnings'), list),
      f"got {type(pf.get('earnings')).__name__}")
check("preflight.breaking_news is a list (>=1)",
      isinstance(pf.get('breaking_news'), list) and len(pf.get('breaking_news', [])) >= 1,
      f"len={len(pf.get('breaking_news', []))}")

# 3b. admin login
print()
t0 = time.time()
r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
print(f"  /api/auth/login (admin): HTTP {r.status_code} in {time.time()-t0:.2f}s")
check("admin login HTTP 200", r.status_code == 200, r.text[:300])
jbody = r.json() if r.ok else {}
check("admin login returned JWT token",
      isinstance(jbody.get('token'), str) and len(jbody.get('token', '')) > 30,
      f"token={jbody.get('token')!r:100.100}")
check("admin login user.is_admin True",
      (jbody.get('user') or {}).get('is_admin') is True,
      f"user={jbody.get('user')}")

# 3c. webhook with correct secret
print()
r = requests.post(
    f"{API}/alerts/webhook",
    json={"content": "NDX weekend regression test @ 26,400"},
    headers={"X-Webhook-Secret": WEBHOOK_SECRET},
    timeout=10,
)
print(f"  /api/alerts/webhook (with X-Webhook-Secret): HTTP {r.status_code}")
check("webhook with correct secret → 200",
      r.status_code == 200,
      f"body={r.text[:200]}")
wbody = r.json() if r.ok else {}
check("webhook response has alert_id",
      bool(wbody.get('alert_id')),
      f"got {wbody}")

# 3d. webhook without secret → 403
r = requests.post(
    f"{API}/alerts/webhook",
    json={"content": "should be rejected"},
    timeout=10,
)
print(f"  /api/alerts/webhook (no secret): HTTP {r.status_code}")
check("webhook without secret → 403",
      r.status_code == 403,
      f"got {r.status_code} body={r.text[:200]}")


# ============================================================
# SUMMARY
# ============================================================
print()
print("=" * 70)
total = PASSED + FAILED
print(f"SUMMARY: {PASSED}/{total} passed, {FAILED} failed")
if FAILURES:
    print("\nFailures:")
    for fl in FAILURES:
        print(f"  • {fl}")
print("=" * 70)

sys.exit(0 if FAILED == 0 else 1)
