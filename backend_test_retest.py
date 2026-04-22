"""
Retest of 2 previously-failing cases in Alerts Command backend:
1. AI sentiment auth gating
2. Admin revoke/restore uses POST
"""
import requests
import uuid
import sys

BASE = "https://alerts-command.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@alertscommand.com"
ADMIN_PASSWORD = "iC_T3UTrwO-Ym1eBwMvdDrlU"

results = []

def rec(name, ok, detail=""):
    results.append((name, ok, detail))
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {name} -- {detail}")

# === Get admin token ===
r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
if r.status_code != 200:
    print(f"FATAL: admin login failed: {r.status_code} {r.text}")
    sys.exit(1)
data = r.json()
admin_token = data.get("token") or data.get("access_token")
if not admin_token:
    print(f"FATAL: no token in login response: {data}")
    sys.exit(1)
print(f"Admin token acquired (len={len(admin_token)})")
admin_hdr = {"Authorization": f"Bearer {admin_token}"}

# ============================================================
# TEST 1: AI sentiment auth gating
# ============================================================
print("\n=== TEST 1: AI sentiment auth gating ===")

# 1a. No token → 401
r = requests.get(f"{BASE}/ai/sentiment", timeout=30)
rec("GET /ai/sentiment without token → 401",
    r.status_code == 401,
    f"got HTTP {r.status_code}; body={r.text[:200]}")

# 1b. Admin token → 200 with `mode` field
r = requests.get(f"{BASE}/ai/sentiment", headers=admin_hdr, timeout=30)
ok_status = r.status_code == 200
mode_present = False
mode_val = None
if ok_status:
    try:
        body = r.json()
        mode_val = body.get("mode")
        mode_present = mode_val is not None
    except Exception as e:
        rec("GET /ai/sentiment admin JSON parse", False, str(e))

rec("GET /ai/sentiment with admin token → 200",
    ok_status,
    f"got HTTP {r.status_code}")
rec("GET /ai/sentiment response contains `mode` field",
    mode_present,
    f"mode={mode_val}")

# ============================================================
# TEST 2: Admin revoke/restore via POST
# ============================================================
print("\n=== TEST 2: Admin revoke/restore via POST ===")

# 2a. Register throwaway user
uniq = uuid.uuid4().hex[:8]
email = f"qa_retest_{uniq}@alertscommand-test.com"
password = "TestUser_987654321!"
username = f"qaretest_{uniq}"
r = requests.post(f"{BASE}/auth/register",
                  json={"email": email, "password": password, "username": username},
                  timeout=15)
if r.status_code != 200:
    rec("Register throwaway user", False, f"HTTP {r.status_code} {r.text[:200]}")
    sys.exit(1)
rb = r.json()
user_token = rb.get("token") or rb.get("access_token")
user_obj = rb.get("user") or {}
user_id = user_obj.get("id")
if not user_id:
    # Fall back: look up via /admin/users
    r2 = requests.get(f"{BASE}/admin/users", headers=admin_hdr, timeout=15)
    if r2.status_code == 200:
        for u in r2.json().get("users", r2.json() if isinstance(r2.json(), list) else []):
            if u.get("email") == email:
                user_id = u.get("id")
                break
rec("Register throwaway user + got id/token",
    bool(user_id) and bool(user_token),
    f"email={email}, id={user_id}")
user_hdr = {"Authorization": f"Bearer {user_token}"}

# Sanity: new user can access /preflight
r = requests.get(f"{BASE}/preflight", headers=user_hdr, timeout=30)
rec("New user can access /preflight (baseline)",
    r.status_code == 200,
    f"HTTP {r.status_code}")

# 2b. POST /admin/users/{id}/revoke → 200
r = requests.post(f"{BASE}/admin/users/{user_id}/revoke", headers=admin_hdr, timeout=15)
rec("POST /admin/users/{id}/revoke → 200",
    r.status_code == 200,
    f"HTTP {r.status_code}; body={r.text[:200]}")

# 2c. Revoked user blocked from /preflight
r = requests.get(f"{BASE}/preflight", headers=user_hdr, timeout=30)
rec("Revoked user blocked from /preflight (expect 401/403)",
    r.status_code in (401, 403),
    f"HTTP {r.status_code}; body={r.text[:200]}")

# 2d. POST /admin/users/{id}/restore → 200
r = requests.post(f"{BASE}/admin/users/{user_id}/restore", headers=admin_hdr, timeout=15)
rec("POST /admin/users/{id}/restore → 200",
    r.status_code == 200,
    f"HTTP {r.status_code}; body={r.text[:200]}")

# 2e. Restored user regains access
r = requests.get(f"{BASE}/preflight", headers=user_hdr, timeout=30)
rec("Restored user regains access to /preflight → 200",
    r.status_code == 200,
    f"HTTP {r.status_code}")

# 2f. DELETE test user
r = requests.delete(f"{BASE}/admin/users/{user_id}", headers=admin_hdr, timeout=15)
rec("DELETE /admin/users/{id} → 200",
    r.status_code == 200,
    f"HTTP {r.status_code}; body={r.text[:200]}")

# ============================================================
# Summary
# ============================================================
print("\n" + "=" * 60)
passed = sum(1 for _, ok, _ in results if ok)
total = len(results)
print(f"RESULTS: {passed}/{total} passed")
for n, ok, d in results:
    print(f"  [{'PASS' if ok else 'FAIL'}] {n}")
sys.exit(0 if passed == total else 1)
