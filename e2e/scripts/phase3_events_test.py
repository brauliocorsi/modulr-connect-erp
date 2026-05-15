#!/usr/bin/env python3
"""
PHASE 3 — Events & notifications.

T1. emit_event direto → 1 row em module_events com payload enriquecido
T2. SO draft→confirmed → evento sale.confirmed
T3. SO confirmed→cancelled → evento sale.cancelled
T4. Picking ready→done → evento inventory.picking.done
T5. notify_group em grupo vazio → 0 inserts, sem erro
T6. Idempotência: re-UPDATE com mesmo state NÃO emite novo evento
Limpa TESTE_E2E_PH3_*.
"""
import os, sys, ssl, datetime, traceback
import pg8000.dbapi as pg

_ctx = ssl.create_default_context(); _ctx.check_hostname=False; _ctx.verify_mode=ssl.CERT_NONE
PG = dict(host=os.environ["PGHOST"], port=int(os.environ.get("PGPORT",5432)),
          user=os.environ["PGUSER"], password=os.environ["PGPASSWORD"],
          database=os.environ["PGDATABASE"], ssl_context=_ctx)

TS  = datetime.datetime.utcnow().strftime("%H%M%S")
PFX = f"TESTE_E2E_PH3_{TS}_"
REPORT=[]
def add(s,e,o,ok,risk=""):
    REPORT.append((s,e,o,ok,risk)); print(f"{'✅' if ok else '❌'} [{s}] {o}")

def main():
    c = pg.connect(**PG); c.autocommit=True; cur=c.cursor()
    so_id=pk_id=partner_id=fg_id=loc_id=cust_loc=wh_id=None
    try:
        wh_id = cur.execute("SELECT id FROM warehouses WHERE active LIMIT 1") or cur.fetchone()[0]
        cur.execute("SELECT id FROM warehouses WHERE active LIMIT 1"); wh_id=cur.fetchone()[0]
        cur.execute("SELECT id FROM stock_locations WHERE warehouse_id=%s AND type='internal' AND active LIMIT 1",(wh_id,))
        loc_id=cur.fetchone()[0]
        cur.execute("SELECT id FROM stock_locations WHERE type='customer' LIMIT 1"); cust_loc=cur.fetchone()[0]
        cur.execute("INSERT INTO products(name,type,active,can_be_sold) VALUES (%s,'storable',true,true) RETURNING id",(PFX+"FG",))
        fg_id=cur.fetchone()[0]
        cur.execute("INSERT INTO partners(name,is_customer) VALUES (%s,true) RETURNING id",(PFX+"CUST",))
        partner_id=cur.fetchone()[0]
        add("setup","ok",f"so/pk to be created", True)

        # ===== T1: emit_event direto
        cur.execute("SELECT emit_event('sales','test.synthetic', '{\"a\":1}'::jsonb, 'unit_test', NULL)")
        ev_id = cur.fetchone()[0]
        cur.execute("SELECT payload FROM module_events WHERE id=%s",(ev_id,))
        pl = cur.fetchone()[0]
        ok = pl.get("a")==1 and pl.get("entity_type")=="unit_test" and "emitted_at" in pl
        add("T1.emit_event","payload merge ok", f"payload={pl}", ok)

        # ===== T2: SO confirmed
        cur.execute("INSERT INTO sale_orders(name,partner_id,state,warehouse_id,amount_total) VALUES (%s,%s,'draft',%s,200) RETURNING id",
                    (PFX+"SO",partner_id,wh_id))
        so_id=cur.fetchone()[0]
        cur.execute("UPDATE sale_orders SET state='confirmed' WHERE id=%s",(so_id,))
        cur.execute("SELECT count(*) FROM module_events WHERE event_type='sale.confirmed' AND payload->>'so_id'=%s",(str(so_id),))
        n = cur.fetchone()[0]
        add("T2.sale.confirmed","1 evento", f"count={n}", n==1)

        # ===== T6 (idempotência): re-update state=confirmed não emite novo evento
        cur.execute("UPDATE sale_orders SET state='confirmed' WHERE id=%s",(so_id,))
        cur.execute("SELECT count(*) FROM module_events WHERE event_type='sale.confirmed' AND payload->>'so_id'=%s",(str(so_id),))
        n2 = cur.fetchone()[0]
        add("T6.idempotency_so_state","mantém 1 evento (IS DISTINCT FROM)", f"count={n2}", n2==1)

        # ===== T3: SO cancelled
        cur.execute("UPDATE sale_orders SET state='cancelled' WHERE id=%s",(so_id,))
        cur.execute("SELECT count(*) FROM module_events WHERE event_type='sale.cancelled' AND payload->>'so_id'=%s",(str(so_id),))
        n3 = cur.fetchone()[0]
        add("T3.sale.cancelled","1 evento",f"count={n3}", n3==1)

        # ===== T4: Picking done
        cur.execute("""INSERT INTO stock_pickings(name,kind,state,warehouse_id,source_location_id,destination_location_id,partner_id,origin)
                       VALUES (%s,'outgoing','ready',%s,%s,%s,%s,%s) RETURNING id""",
                    (PFX+"PK",wh_id,loc_id,cust_loc,partner_id,PFX+"SO"))
        pk_id=cur.fetchone()[0]
        cur.execute("UPDATE stock_pickings SET state='done' WHERE id=%s",(pk_id,))
        cur.execute("SELECT count(*) FROM module_events WHERE event_type='inventory.picking.done' AND payload->>'picking_id'=%s",(str(pk_id),))
        n4 = cur.fetchone()[0]
        add("T4.picking.done","1 evento",f"count={n4}", n4==1)

        # ===== T5: notify_group vazio
        cur.execute("SELECT notify_group(%s,'sales'::app_module,'test.fanout','x')",(PFX+"NO_GROUP",))
        sent = cur.fetchone()[0]
        add("T5.notify_group_empty","0 envios sem erro",f"sent={sent}", sent==0)

    except Exception as e:
        traceback.print_exc(); add("FATAL","no exception",str(e)[:200],False,"abort")
    finally:
        try:
            cur.execute("BEGIN")
            cur.execute("DELETE FROM module_events WHERE event_type IN ('test.synthetic','sale.confirmed','sale.cancelled','inventory.picking.done') AND (payload->>'entity_type'='unit_test' OR payload->>'so_id'=%s OR payload->>'picking_id'=%s)",
                        (str(so_id) if so_id else '', str(pk_id) if pk_id else ''))
            cur.execute("DELETE FROM stock_pickings WHERE name LIKE %s",(PFX+"%",))
            cur.execute("DELETE FROM sale_orders WHERE name LIKE %s",(PFX+"%",))
            cur.execute("DELETE FROM products WHERE name LIKE %s",(PFX+"%",))
            cur.execute("DELETE FROM partners WHERE name LIKE %s",(PFX+"%",))
            cur.execute("COMMIT"); print("🧹 cleanup OK")
        except Exception as e:
            print(f"⚠ cleanup: {e}")
            try: cur.execute("ROLLBACK")
            except: pass

    rep=["# Phase 3 — Events report",f"_run: {datetime.datetime.utcnow().isoformat()}_","",
         "| # | Step | Expected | Observed | Status |","|---|---|---|---|---|"]
    fails=0
    for i,(s,e,o,ok,r) in enumerate(REPORT,1):
        rep.append(f"| {i} | {s} | {e} | {o[:140]} | {'✅' if ok else '❌'} |")
        if not ok: fails+=1
    rep+=["",f"**TOTAL: {len(REPORT)-fails}/{len(REPORT)} OK**"]
    out="\n".join(rep)
    os.makedirs("/mnt/documents",exist_ok=True)
    with open("/mnt/documents/phase3-events-report.md","w") as f: f.write(out)
    print("\n"+out)
    sys.exit(1 if fails else 0)

if __name__=="__main__": main()
