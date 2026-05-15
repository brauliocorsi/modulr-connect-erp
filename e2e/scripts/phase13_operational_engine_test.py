#!/usr/bin/env python3
"""Phase 13 — Operational Engine E2E. Calls _test_phase13 RPC and prints/saves report."""
import os, json, urllib.request, datetime, sys

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

def rpc(name, body=None):
    req = urllib.request.Request(f"{URL}/rest/v1/rpc/{name}",
        data=json.dumps(body or {}).encode(), headers=H, method="POST")
    return json.loads(urllib.request.urlopen(req).read())

def main():
    res = rpc("_test_phase13")
    tests = res.get("tests", [])
    print(f"prefix={res.get('prefix')} total={res.get('total')} passed={res.get('passed')} failed={res.get('failed')}")
    lines = ["# Phase 13 — Operational Engine report",
             f"_run: {datetime.datetime.now(datetime.UTC).isoformat()}_","",
             "| # | Test | Status | Observed |", "|---|---|---|---|"]
    for i, t in enumerate(tests, 1):
        ok = "✅" if t.get("passed") else "❌"
        print(f"{ok} [{t['name']}] {t.get('observed')}")
        lines.append(f"| {i} | {t['name']} | {ok} | {json.dumps(t.get('observed'), default=str)[:200]} |")
    lines += ["", f"**TOTAL: {res.get('passed')}/{res.get('total')} OK**"]
    os.makedirs("/mnt/documents", exist_ok=True)
    with open("/mnt/documents/phase13-operational-engine-report.md", "w") as f:
        f.write("\n".join(lines))
    sys.exit(0 if res.get("failed", 0) == 0 else 1)

if __name__ == "__main__":
    main()
