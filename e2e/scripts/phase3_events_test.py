#!/usr/bin/env python3
"""PHASE 3 — Events & notifications. Runs SECURITY DEFINER helper _test_phase3()."""
import os, sys, ssl, datetime, json
import pg8000.dbapi as pg

_ctx=ssl.create_default_context(); _ctx.check_hostname=False; _ctx.verify_mode=ssl.CERT_NONE
PG=dict(host=os.environ["PGHOST"],port=int(os.environ.get("PGPORT",5432)),
        user=os.environ["PGUSER"],password=os.environ["PGPASSWORD"],
        database=os.environ["PGDATABASE"],ssl_context=_ctx)

c=pg.connect(**PG); c.autocommit=True; cur=c.cursor()
cur.execute("SELECT _test_phase3()")
res = cur.fetchone()[0]
asserts = res["asserts"]
fails=0
rep=["# Phase 3 — Events & notifications report",
     f"_run: {datetime.datetime.utcnow().isoformat()}_","",
     "| # | Step | OK | Observed |","|---|---|---|---|"]
for i,a in enumerate(asserts,1):
    ok=a["ok"]; mark="✅" if ok else "❌"
    if not ok: fails+=1
    print(f"{mark} [{a['step']}] {a['observed']}")
    rep.append(f"| {i} | {a['step']} | {mark} | {json.dumps(a['observed'])} |")
rep+=["",f"**TOTAL: {len(asserts)-fails}/{len(asserts)} OK**"]
out="\n".join(rep)
os.makedirs("/mnt/documents",exist_ok=True)
with open("/mnt/documents/phase3-events-report.md","w") as f: f.write(out)
print("\n"+out)
sys.exit(1 if fails else 0)
