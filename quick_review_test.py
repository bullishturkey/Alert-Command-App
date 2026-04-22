"""Quick review test per review_request: 3 items only."""
import requests
import json
import sys

BASE = "https://alerts-command.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@alertscommand.com"
ADMIN_PASSWORD = "iC_T3UTrwO-Ym1eBwMvdDrlU"

passes = []
fails = []

def P(msg): passes.append(msg); print(f"✅ {msg}")
def F(msg): fails.append(msg); print(f"❌ {msg}")

# --- Login as admin ---
print("\n=== Admin login ===")
r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
if r.status_code != 200:
    F(f"Admin login failed: {r.status_code} {r.text[:200]}")
    sys.exit(1)
data = r.json()
token = data.get("token") or data.get("access_token")
if not token:
    F(f"No token field in login response: keys={list(data.keys())}")
    sys.exit(1)
P(f"Admin login success, token received (field 'token' present: {'token' in data})")
H = {"Authorization": f"Bearer {token}"}

# --- Test 1: Admin alert creation via /api/alerts POST ---
print("\n=== Test 1: POST /api/alerts ===")
payload = {"title": "QA Test", "message": "sanity check", "type": "info", "ticker": "NDX", "severity": "high"}
r = requests.post(f"{BASE}/alerts", json=payload, headers=H, timeout=30)
if r.status_code == 200:
    alert = r.json()
    alert_id = alert.get("id")
    if alert_id:
        P(f"POST /api/alerts → 200 with id={alert_id}, title={alert.get('title')}, ticker={alert.get('ticker')}, severity={alert.get('severity')}, source={alert.get('source')}")
        # DELETE
        rd = requests.delete(f"{BASE}/alerts/{alert_id}", headers=H, timeout=30)
        if rd.status_code == 200:
            P(f"DELETE /api/alerts/{alert_id} → 200 {rd.json()}")
        else:
            F(f"DELETE /api/alerts/{alert_id} → {rd.status_code} {rd.text[:200]}")
    else:
        F(f"POST /api/alerts returned 200 but no 'id' in body: {alert}")
else:
    F(f"POST /api/alerts → {r.status_code} {r.text[:300]}")

# --- Test 2 & 3: /api/ai/sentiment ---
print("\n=== Test 2/3: GET /api/ai/sentiment ===")
r = requests.get(f"{BASE}/ai/sentiment", headers=H, timeout=60)
if r.status_code != 200:
    F(f"GET /api/ai/sentiment → {r.status_code} {r.text[:300]}")
else:
    P(f"GET /api/ai/sentiment → 200")
    s = r.json()
    mode = s.get("mode")
    print(f"  mode = {mode}")
    print(f"  ndx_price = {s.get('ndx_price')}, ndx_change = {s.get('ndx_change')}")
    if mode == "daily_recap":
        dr = s.get("daily_recap") or {}
        indexes = dr.get("indexes") or []
        if not indexes:
            F("daily_recap.indexes is empty")
        else:
            first = indexes[0]
            print(f"  daily_recap.indexes[0] = {first}")
            cp = first.get("change_pct")
            if cp is None:
                F("daily_recap.indexes[0].change_pct missing")
            elif abs(cp) >= 6:
                F(f"daily_recap.indexes[0].change_pct = {cp}% — unrealistic single-day move (absolute >= 6%); likely 7-day range bug")
            else:
                P(f"daily_recap.indexes[0].change_pct = {cp}% (abs<6%, realistic single-day)")
            # Log all index changes for context
            print(f"  All index change_pct: {[(i.get('symbol'), i.get('change_pct')) for i in indexes]}")
        # top_gainers / top_losers
        tg = dr.get("top_gainers")
        tl = dr.get("top_losers")
        if tg is None:
            F("daily_recap.top_gainers missing")
        else:
            if not isinstance(tg, list) or len(tg) == 0:
                F(f"daily_recap.top_gainers not a non-empty list: {tg}")
            else:
                # Ordered DESC by change_pct
                pcts = [g.get("change_pct") for g in tg if g.get("change_pct") is not None]
                ordered = all(pcts[i] >= pcts[i+1] for i in range(len(pcts)-1))
                if ordered:
                    P(f"daily_recap.top_gainers present ({len(tg)}), ordered DESC: {[(g.get('symbol'), g.get('change_pct')) for g in tg[:5]]}")
                else:
                    F(f"daily_recap.top_gainers NOT ordered DESC: {pcts}")
        if tl is None:
            F("daily_recap.top_losers missing")
        else:
            if not isinstance(tl, list) or len(tl) == 0:
                F(f"daily_recap.top_losers not a non-empty list: {tl}")
            else:
                pcts = [l.get("change_pct") for l in tl if l.get("change_pct") is not None]
                ordered = all(pcts[i] <= pcts[i+1] for i in range(len(pcts)-1))
                if ordered:
                    P(f"daily_recap.top_losers present ({len(tl)}), ordered ASC: {[(l.get('symbol'), l.get('change_pct')) for l in tl[:5]]}")
                else:
                    F(f"daily_recap.top_losers NOT ordered ASC: {pcts}")
    elif mode == "weekly_recap":
        wr = s.get("weekly_recap") or {}
        indexes = wr.get("indexes") or []
        if not indexes:
            F("weekly_recap.indexes empty")
        else:
            first = indexes[0]
            ow = first.get("open_week")
            pr = first.get("price")
            print(f"  weekly_recap.indexes[0] = {first}")
            if isinstance(ow, (int, float)) and isinstance(pr, (int, float)):
                P(f"weekly_recap.indexes[0].open_week={ow} (float), price={pr} (float)")
            else:
                F(f"weekly_recap.indexes[0] open_week or price not floats: open_week={ow!r}, price={pr!r}")
        P("mode=weekly_recap returned 200 (no 500s)")
    elif mode == "live":
        P("mode=live; skipping daily/weekly recap field checks per review (endpoint returned 200, no 500s)")
    else:
        F(f"Unexpected mode value: {mode!r}")

print("\n\n=== SUMMARY ===")
print(f"Passes: {len(passes)}")
print(f"Fails: {len(fails)}")
for f in fails:
    print(f"  ❌ {f}")
sys.exit(0 if not fails else 1)
