#!/usr/bin/env python3
"""
PHASE 2 — Concurrency & idempotency tests.

T1. 8 reservas paralelas do mesmo produto → soma das reservas = stock,
    nenhuma negativa, todas as exceções são 'Stock insuficiente'.
T2. 10 chamadas paralelas a register_customer_payment com a MESMA
    idempotency_key → exatamente 1 customer_payment criado.
T3. 10 chamadas paralelas com chaves DIFERENTES → 10 pagamentos.
T4. Trigger cash_movement: 1 pagamento gera no máximo 1 cash_movement
    (ou zero se não houver sessão aberta — aceitável).
Limpa TESTE_E2E_PH2_*.
"""
import os, sys, ssl, datetime, traceback, threading, uuid
import pg8000.dbapi as pg

_ctx = ssl.create_default_context(); _ctx.check_hostname=False; _ctx.verify_mode=ssl.CERT_NONE
PG = dict(host=os.environ["PGHOST"], port=int(os.environ.get("PGPORT",5432)),
          user=os.environ["PGUSER"], password=os.environ["PGPASSWORD"],
          database=os.environ["PGDATABASE"], ssl_context=_ctx)

TS  = datetime.datetime.utcnow().strftime("%H%M%S")
PFX = f"TESTE_E2E_PH2_{TS}_"
REPORT = []

def add(s,e,o,ok,risk=""):
    REPORT.append((s,e,o,ok,risk))
    print(f"{'✅' if ok else '❌'} [{s}] {o}")

def conn(): return pg.connect(**PG)
def q1(c, sql, *a):
    c.execute(sql,a); cols=[d[0] for d in c.description]; r=c.fetchone()
    return dict(zip(cols,r)) if r else None
def x(c, sql, *a): c.execute(sql,a)

def main():
    setup = conn(); setup.autocommit=True; cur=setup.cursor()
    fg_id=comp_id=loc_id=wh_id=partner_id=method_id=so_id=None
    try:
        wh_id = q1(cur,"SELECT id FROM warehouses WHERE active ORDER BY created_at LIMIT 1")["id"]
        loc_id = q1(cur,"SELECT id FROM stock_locations WHERE warehouse_id=%s AND type='internal' AND active ORDER BY (parent_id IS NULL) DESC LIMIT 1",wh_id)["id"]
        cust_loc = q1(cur,"SELECT id FROM stock_locations WHERE type='customer' LIMIT 1")["id"]
        cur.execute("INSERT INTO products(name,type,active,can_be_sold) VALUES (%s,'storable',true,true) RETURNING id",(PFX+"FG",))
        fg_id=cur.fetchone()[0]
        cur.execute("INSERT INTO partners(name,is_customer) VALUES (%s,true) RETURNING id",(PFX+"CUST",))
        partner_id=cur.fetchone()[0]
        cur.execute("INSERT INTO stock_quants(product_id,location_id,quantity) VALUES (%s,%s,10)",(fg_id,loc_id))
        m = q1(cur,"SELECT id FROM payment_methods LIMIT 1")
        method_id = m["id"] if m else None
        # SO básica
        cur.execute("INSERT INTO sale_orders(name,partner_id,state,warehouse_id,amount_total) VALUES (%s,%s,'confirmed',%s,500) RETURNING id",
                    (PFX+"SO",partner_id,wh_id))
        so_id = cur.fetchone()[0]
        add("setup","ok",f"fg={str(fg_id)[:8]} so={str(so_id)[:8]}",True)

        # ========== T1: 8 reservas paralelas, cada uma pede 3 (stock=10)
        # Esperado: no máx 3 sucessos (3*3=9 ≤ 10), restantes falham com check_violation
        pickings=[]
        for i in range(8):
            cur.execute("""INSERT INTO stock_pickings(name,kind,state,warehouse_id,source_location_id,destination_location_id,partner_id,origin)
                          VALUES (%s,'outgoing','draft',%s,%s,%s,%s,%s) RETURNING id""",
                        (f"{PFX}PK{i}",wh_id,loc_id,cust_loc,partner_id,PFX+"SO"))
            pid=cur.fetchone()[0]
            cur.execute("INSERT INTO stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,state) VALUES (%s,%s,%s,%s,3,'draft')",
                        (pid,fg_id,loc_id,cust_loc))
            pickings.append(pid)

        results=[]
        lock_r = threading.Lock()
        def worker(pid):
            c=conn(); c.autocommit=True; cu=c.cursor()
            try:
                cu.execute(f"SELECT reserve_picking_strict('{pid}'::uuid)")
                cu.fetchone()
                with lock_r: results.append(("ok",pid,None))
            except Exception as e:
                with lock_r: results.append(("err",pid,str(e)[:200]))
            finally: c.close()
        ts=[threading.Thread(target=worker,args=(p,)) for p in pickings]
        for t in ts: t.start()
        for t in ts: t.join()

        ok_count=sum(1 for r in results if r[0]=="ok")
        err_count=sum(1 for r in results if r[0]=="err")
        ins_count=sum(1 for r in results if r[0]=="err" and "Stock insuficiente" in (r[2] or ""))
        # debug
        for r in results[:3]:
            if r[0]=="err": print(f"   sample err: {r[2]}")
        for r in results3[:3] if False else []: pass
        st = q1(cur,"SELECT quantity, reserved_quantity FROM stock_quants WHERE product_id=%s AND location_id=%s",fg_id,loc_id)
        neg = q1(cur,"SELECT count(*) c FROM stock_quants WHERE reserved_quantity<0")
        ok = (float(st["reserved_quantity"]) == ok_count*3
              and float(st["reserved_quantity"]) <= float(st["quantity"])
              and int(neg["c"])==0
              and ok_count + err_count == 8
              and err_count == ins_count)
        add("T1.parallel_reserve",
            "reserved == ok_count*3, sem negativos, todos os erros = 'Stock insuficiente'",
            f"ok={ok_count} err={err_count} ins_err={ins_count} reserved={st['reserved_quantity']} qty={st['quantity']}",
            ok, "" if ok else "corrida na reserva pode permitir over-reserve")

        # ========== T2: idempotência por chave igual
        if method_id:
            key = "K-"+uuid.uuid4().hex[:10]
            results2=[]
            def pay_worker(k):
                c=conn(); c.autocommit=True; cu=c.cursor()
                try:
                    cu.execute("SELECT (register_customer_payment(%s,%s,%s,NULL,NULL,NULL,%s,NULL)).id",
                               (so_id, 10, method_id, k))
                    results2.append(("ok",cu.fetchone()[0]))
                except Exception as e:
                    results2.append(("err",str(e)[:80]))
                finally: c.close()
            ts=[threading.Thread(target=pay_worker,args=(key,)) for _ in range(10)]
            for t in ts: t.start()
            for t in ts: t.join()

            cnt = q1(cur,"SELECT count(*) c FROM customer_payments WHERE order_id=%s AND idempotency_key=%s",so_id,key)
            ok = int(cnt["c"]) == 1
            add("T2.idempotency_same_key","exatamente 1 customer_payment",
                f"created={cnt['c']} workers={len(results2)}", ok)

            # ========== T3: chaves diferentes → 10 pagamentos
            keys=[f"K-{uuid.uuid4().hex[:8]}" for _ in range(10)]
            results3=[]
            def pay_diff(k):
                c=conn(); c.autocommit=True; cu=c.cursor()
                try:
                    cu.execute("SELECT (register_customer_payment(%s,%s,%s,NULL,NULL,NULL,%s,NULL)).id",
                               (so_id, 1, method_id, k))
                    results3.append(("ok",cu.fetchone()[0]))
                except Exception as e:
                    results3.append(("err",str(e)[:80]))
                finally: c.close()
            ts=[threading.Thread(target=pay_diff,args=(k,)) for k in keys]
            for t in ts: t.start()
            for t in ts: t.join()
            cnt2 = q1(cur,"SELECT count(*) c FROM customer_payments WHERE order_id=%s AND idempotency_key = ANY(%s)",so_id,keys)
            ok = int(cnt2["c"]) == 10
            add("T3.different_keys","10 pagamentos criados",f"created={cnt2['c']}",ok)

            # ========== T4: cash_movement no máx 1 por payment
            dup = q1(cur,"""SELECT COUNT(*) c FROM (
                              SELECT payment_id, COUNT(*) n FROM cash_movements
                              WHERE payment_id IN (SELECT id FROM customer_payments WHERE order_id=%s)
                              GROUP BY payment_id HAVING COUNT(*)>1) z""",so_id)
            ok = int(dup["c"])==0
            add("T4.cash_movement_no_dup","0 pagamentos com >1 cash_movement",
                f"duplicados={dup['c']}",ok)
        else:
            add("T2-T4","skip","sem payment_methods configurado",True)

    except Exception as e:
        traceback.print_exc()
        add("FATAL","no exception",str(e),False,"abort")
    finally:
        try:
            cur.execute("BEGIN")
            cur.execute("DELETE FROM cash_movements WHERE payment_id IN (SELECT id FROM customer_payments WHERE order_id=%s)",(so_id,)) if so_id else None
            cur.execute("DELETE FROM customer_payments WHERE order_id=%s",(so_id,)) if so_id else None
            cur.execute("DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE name LIKE %s)",(PFX+"%",))
            cur.execute("DELETE FROM stock_pickings WHERE name LIKE %s",(PFX+"%",))
            cur.execute("DELETE FROM sale_orders WHERE name LIKE %s",(PFX+"%",))
            cur.execute("DELETE FROM stock_quants WHERE product_id IN (SELECT id FROM products WHERE name LIKE %s)",(PFX+"%",))
            cur.execute("DELETE FROM products WHERE name LIKE %s",(PFX+"%",))
            cur.execute("DELETE FROM partners WHERE name LIKE %s",(PFX+"%",))
            cur.execute("COMMIT"); print("🧹 cleanup OK")
        except Exception as e:
            print(f"⚠ cleanup: {e}")
            try: cur.execute("ROLLBACK")
            except: pass

    rep=["# Phase 2 — Concurrency report",f"_run: {datetime.datetime.utcnow().isoformat()}_","",
         "| # | Step | Expected | Observed | Status | Risk |","|---|---|---|---|---|---|"]
    fails=0
    for i,(s,e,o,ok,r) in enumerate(REPORT,1):
        rep.append(f"| {i} | {s} | {e} | {o[:140]} | {'✅' if ok else '❌'} | {r} |")
        if not ok: fails+=1
    rep+=["",f"**TOTAL: {len(REPORT)-fails}/{len(REPORT)} OK**"]
    out="\n".join(rep)
    os.makedirs("/mnt/documents",exist_ok=True)
    with open("/mnt/documents/phase2-concurrency-report.md","w") as f: f.write(out)
    print("\n"+out)
    sys.exit(1 if fails else 0)

if __name__=="__main__": main()
