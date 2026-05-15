"""
Phase 11 — Operational Health Monitor E2E test.

Injects controlled inconsistencies and verifies erp_health_check() detects them.
Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
"""
import os, json, sys, urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

def rpc(name, body=None):
    req = urllib.request.Request(
        f"{URL}/rest/v1/rpc/{name}",
        data=json.dumps(body or {}).encode(),
        headers=H, method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def main():
    # 1) Run self-test (created in migration)
    res = rpc("_test_phase11")
    print("Self-test:", json.dumps(res, indent=2, default=str))
    tests = res.get("tests", [])
    failed = [t for t in tests if not t.get("passed")]
    if failed:
        print("FAILED:", failed); sys.exit(1)

    # 2) Run main health check
    health = rpc("erp_health_check", {"_threshold_days": 7})
    print("\nSummary:", json.dumps(health["summary"], indent=2, default=str))
    print(f"\nFindings: {len(health['findings'])}")
    by_cat = {}
    for f in health["findings"]:
        by_cat[f["category"]] = by_cat.get(f["category"], 0) + 1
    for cat, n in sorted(by_cat.items()):
        print(f"  {cat}: {n}")

    # 3) Persisted run
    log_id = rpc("erp_health_check_run", {"_threshold_days": 7})
    print(f"\nLog persisted: {log_id}")
    print("\n✅ Phase 11 OK")

if __name__ == "__main__":
    main()
