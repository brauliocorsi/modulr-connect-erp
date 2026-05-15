"""Phase 12 — Safe Remediation E2E. Calls dry_run + apply_safe on the latest health-check log."""
import os, json, urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

def rpc(name, body=None):
    req = urllib.request.Request(f"{URL}/rest/v1/rpc/{name}",
        data=json.dumps(body or {}).encode(), headers=H, method="POST")
    return json.loads(urllib.request.urlopen(req).read())

def main():
    res = rpc("_test_phase12")
    print(json.dumps(res, indent=2, default=str))
    failed = [t for t in res.get("tests", []) if not t.get("passed")]
    assert not failed, f"FAILED: {failed}"

    run_id = rpc("erp_health_check_run", {"_threshold_days": 7})
    dry = rpc("erp_health_remediate", {"_run_id": run_id, "_mode": "dry_run"})
    print("DRY:", json.dumps(dry["counts"], indent=2))
    apply = rpc("erp_health_remediate", {"_run_id": run_id, "_mode": "apply_safe"})
    print("APPLY:", json.dumps(apply["counts"], indent=2))
    print("UNSAFE samples:")
    for u in apply["unsafe_fixes_requiring_approval"][:5]:
        print(" -", u["code"], u.get("entity_id"), "—", u.get("detail"))
    print("\n✅ Phase 12 OK")

if __name__ == "__main__":
    main()
