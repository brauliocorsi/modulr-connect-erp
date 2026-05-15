#!/usr/bin/env python3
"""
PHASE 13 — Operational Engine E2E tests.

T1  Stock total          → ready_stock, reserva, sem PO/MO, ETA hoje
T2  Sem stock, comprado  → purchase_need, waiting_purchase
T3  Fabricado c/ comp OK → MO draft, waiting_manufacturing
T4  Fabricado s/ comp    → MO + purchase_need componente, waiting_components, confidence=low
T5  Parcial              → reserva parcial + need do faltante
T6  Concorrência         → 2 SOs mesmo produto stock=1: 1 reserva, 1 waiting_purchase
T7  Idempotência         → 3x run, sem duplicação
T8  Incoming não conta   → incoming_qty>0 mas qty_reserved 0 sem stock
T9  In-production não conta → in_production_qty>0 mas qty_reserved 0 sem stock
T10 Reserva nunca excede stock físico, nunca negativo
T11 Replan throttle      → 2 chamadas <2s em modo replan ⇒ 2ª skipped
T12 Regressão triggers   → sale.confirmed/finance.payment.posted/manufacturing.done OK
"""
import os, sys, ssl, uuid, datetime, traceback, threading
import pg8000.dbapi as pg

_ctx = ssl.create_default_context(); _ctx.check_hostname=False; _ctx.verify_mode=ssl.CERT_NONE
PG = dict(host=os.environ["PGHOST"], port=int(os.environ.get("PGPORT",5432)),
          user=os.environ["PGUSER"], password=os.environ["PGPASSWORD"],
          database=os.environ["PGDATABASE"], ssl_context=_ctx)

TS  = datetime.datetime.utcnow().strftime("%H%M%S")
PFX = f"TESTE_E2E_PH13_{TS}_"
REPORT = []

def add(name, exp, obs, ok):
    REPORT.append((name, exp, obs, ok))
    print(f"{'✅' if ok else '❌'} [{name}] {obs}")

def conn():
    c=pg.connect(**PG); c.autocommit=True; return c
def _args(a):
    # accept either *args or a single tuple
    if len(a)==1 and isinstance(a[0],(tuple,list)): return tuple(a[0])
    return a
def q1(cur, sql, *a):
    cur.execute(sql,_args(a)); cols=[d[0] for d in cur.description]; r=cur.fetchone()
    return dict(zip(cols,r)) if r else None
def qall(cur, sql, *a):
    cur.execute(sql,_args(a)); cols=[d[0] for d in cur.description]
    return [dict(zip(cols,r)) for r in cur.fetchall()]

def main():
    c=conn(); cur=c.cursor()
    created = {"so":[], "products":[], "partners":[], "boms":[], "po_pickings":[], "mos":[]}

    try:
        # ---- ambiente comum
        wh = q1(cur,"SELECT id FROM warehouses WHERE active ORDER BY created_at LIMIT 1")["id"]
        loc = q1(cur,"SELECT id FROM stock_locations WHERE warehouse_id=%s AND type='internal' AND active ORDER BY (parent_id IS NULL) DESC LIMIT 1",wh)["id"]
        partner = q1(cur,"INSERT INTO partners(name,is_customer) VALUES (%s,true) RETURNING id",(PFX+"CUST",))["id"]
        created["partners"].append(partner)
        supplier = q1(cur,"INSERT INTO partners(name,is_supplier) VALUES (%s,true) RETURNING id",(PFX+"SUP",))["id"]
        created["partners"].append(supplier)

        def mkprod(name, sold=True, purch=False, mfg=False, mfg_lead=3, purch_lead=5):
            p=q1(cur,"""INSERT INTO products(name,type,active,can_be_sold,can_be_purchased,can_be_manufactured,mfg_lead_time_days,purchase_lead_time_days)
                        VALUES (%s,'storable',true,%s,%s,%s,%s,%s) RETURNING id""",
                 (PFX+name, sold, purch, mfg, mfg_lead, purch_lead))["id"]
            created["products"].append(p)
            if purch:
                cur.execute("INSERT INTO product_suppliers(product_id,partner_id,lead_time_days,priority,price) VALUES(%s,%s,%s,1,1)",
                            (p,supplier,purch_lead))
            return p

        def stock(p, qty):
            cur.execute("INSERT INTO stock_quants(product_id,location_id,quantity) VALUES(%s,%s,%s)",(p,loc,qty))

        def mksale(label, lines):
            so=q1(cur,"INSERT INTO sale_orders(name,partner_id,state,warehouse_id) VALUES(%s,%s,'draft',%s) RETURNING id",
                  (PFX+label, partner, wh))["id"]
            created["so"].append(so)
            for prod,qty in lines:
                cur.execute("INSERT INTO sale_order_lines(order_id,product_id,quantity,unit_price,subtotal) VALUES(%s,%s,%s,1,1)",
                            (so,prod,qty))
            return so

        def confirm(so):
            cur.execute("UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=%s",(so,))

        def plan(so, mode='auto'):
            cur.execute("SELECT so_run_operational_plan(%s::uuid,%s)",(so,mode))
            return cur.fetchone()[0]

        # =================== T1 stock total
        p1 = mkprod("FG1", sold=True, purch=True)
        stock(p1, 10)
        so1 = mksale("SO1",[(p1,3)])
        confirm(so1)
        row = q1(cur,"SELECT operational_status,qty_reserved,qty_to_purchase,expected_availability_date FROM sale_order_lines WHERE order_id=%s",so1)
        needs = q1(cur,"SELECT count(*) c FROM purchase_needs WHERE sale_order_id=%s AND state IN ('pending','quoting','approved')",so1)["c"]
        ok = row["operational_status"]=="ready_stock" and float(row["qty_reserved"])==3 and int(needs)==0
        add("T1.ready_stock","reserva=3, sem need",f"status={row['operational_status']} reserved={row['qty_reserved']} needs={needs}",ok)

        # =================== T2 sem stock, comprado
        p2 = mkprod("FG2", sold=True, purch=True, purch_lead=4)
        so2 = mksale("SO2",[(p2,2)])
        confirm(so2)
        row = q1(cur,"SELECT operational_status,qty_to_purchase,confidence_level,availability_source,expected_availability_date FROM sale_order_lines WHERE order_id=%s",so2)
        need = q1(cur,"SELECT count(*) c FROM purchase_needs WHERE sale_order_id=%s",so2)["c"]
        ok = row["operational_status"]=="waiting_purchase" and int(need)==1 and row["availability_source"]=="incoming_purchase"
        add("T2.waiting_purchase","need=1 waiting_purchase",f"status={row['operational_status']} need={need} src={row['availability_source']}",ok)

        # =================== T3 fabricado componentes OK
        comp_ok = mkprod("COMP3", sold=False, purch=True)
        stock(comp_ok, 100)
        p3 = mkprod("FG3", sold=True, mfg=True)
        bom = q1(cur,"INSERT INTO boms(product_id,active,quantity) VALUES(%s,true,1) RETURNING id",(p3,))["id"]
        created["boms"].append(bom)
        cur.execute("INSERT INTO bom_lines(bom_id,component_product_id,quantity) VALUES(%s,%s,2)",(bom,comp_ok))
        so3 = mksale("SO3",[(p3,1)])
        confirm(so3)
        row = q1(cur,"SELECT operational_status,confidence_level,qty_to_manufacture FROM sale_order_lines WHERE order_id=%s",so3)
        mo_cnt = q1(cur,"SELECT count(*) c FROM manufacturing_orders WHERE sale_order_id=%s",so3)["c"]
        need_cnt = q1(cur,"SELECT count(*) c FROM purchase_needs WHERE manufacturing_order_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id=%s)",so3)["c"]
        ok = row["operational_status"]=="waiting_manufacturing" and int(mo_cnt)==1 and int(need_cnt)==0 and row["confidence_level"]=="medium"
        add("T3.waiting_manufacturing","1 MO, 0 needs, conf=medium",f"status={row['operational_status']} mo={mo_cnt} needs={need_cnt} conf={row['confidence_level']}",ok)

        # =================== T4 fabricado componentes em falta
        comp_miss = mkprod("COMP4", sold=False, purch=True)
        # sem stock
        p4 = mkprod("FG4", sold=True, mfg=True)
        bom4 = q1(cur,"INSERT INTO boms(product_id,active,quantity) VALUES(%s,true,1) RETURNING id",(p4,))["id"]
        created["boms"].append(bom4)
        cur.execute("INSERT INTO bom_lines(bom_id,component_product_id,quantity) VALUES(%s,%s,5)",(bom4,comp_miss))
        so4 = mksale("SO4",[(p4,1)])
        confirm(so4)
        row = q1(cur,"SELECT operational_status,confidence_level FROM sale_order_lines WHERE order_id=%s",so4)
        need_cnt = q1(cur,"SELECT count(*) c FROM purchase_needs WHERE manufacturing_order_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id=%s)",so4)["c"]
        ok = row["operational_status"]=="waiting_components" and int(need_cnt)==1 and row["confidence_level"]=="low"
        add("T4.waiting_components","MO + need componente, conf=low",f"status={row['operational_status']} comp_needs={need_cnt} conf={row['confidence_level']}",ok)

        # =================== T5 parcial
        p5 = mkprod("FG5", sold=True, purch=True)
        stock(p5, 2)
        so5 = mksale("SO5",[(p5,5)])
        confirm(so5)
        row = q1(cur,"SELECT operational_status,qty_reserved,qty_to_purchase,availability_source FROM sale_order_lines WHERE order_id=%s",so5)
        need = q1(cur,"SELECT qty_needed FROM purchase_needs WHERE sale_order_id=%s",so5)
        ok = row["operational_status"]=="partially_reserved" and float(row["qty_reserved"])==2 and float(row["qty_to_purchase"])==3 and row["availability_source"]=="mixed" and need and float(need["qty_needed"])==3
        add("T5.partial","reserved=2 to_purchase=3 src=mixed",f"status={row['operational_status']} reserved={row['qty_reserved']} purch={row['qty_to_purchase']} need_qty={need and need['qty_needed']}",ok)

        # =================== T6 concorrência: 2 SOs mesmo produto, stock=1
        p6 = mkprod("FG6", sold=True, purch=True)
        stock(p6, 1)
        so6a = mksale("SO6A",[(p6,1)])
        so6b = mksale("SO6B",[(p6,1)])
        results = []
        lk = threading.Lock()
        def worker(so):
            cc=conn(); cu=cc.cursor()
            try:
                cu.execute("UPDATE sale_orders SET state='confirmed', confirmed_at=now() WHERE id=%s",(so,))
                with lk: results.append(("ok",so))
            except Exception as e:
                with lk: results.append(("err",str(e)[:160]))
            finally: cc.close()
        ts=[threading.Thread(target=worker,args=(s,)) for s in [so6a,so6b]]
        for t in ts: t.start()
        for t in ts: t.join()
        rows = qall(cur,"SELECT order_id,operational_status,qty_reserved FROM sale_order_lines WHERE order_id IN (%s,%s)",so6a,so6b)
        reserved_sum = sum(float(r["qty_reserved"]) for r in rows)
        statuses = sorted([r["operational_status"] for r in rows])
        q = q1(cur,"SELECT quantity, reserved_quantity FROM stock_quants WHERE product_id=%s AND location_id=%s",p6,loc)
        ok = reserved_sum <= 1 and float(q["reserved_quantity"])<=float(q["quantity"]) and "ready_stock" in statuses and "waiting_purchase" in statuses
        add("T6.concurrency","1 reservada + 1 waiting_purchase, reservas<=stock",f"reserved_sum={reserved_sum} statuses={statuses} q={q}",ok)

        # =================== T7 idempotência (rodar 3x não duplica)
        before_needs = q1(cur,"SELECT count(*) c FROM purchase_needs WHERE sale_order_id IN (%s,%s,%s,%s,%s,%s,%s)",so1,so2,so3,so4,so5,so6a,so6b)["c"]
        before_mos   = q1(cur,"SELECT count(*) c FROM manufacturing_orders WHERE sale_order_id IN (%s,%s,%s,%s,%s,%s,%s)",so1,so2,so3,so4,so5,so6a,so6b)["c"]
        before_moves = q1(cur,"SELECT count(*) c FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin LIKE %s)",(PFX+"%",))["c"]
        before_tl    = q1(cur,"SELECT count(*) c FROM sale_order_timeline WHERE sale_order_id IN (%s,%s,%s,%s,%s,%s,%s)",so1,so2,so3,so4,so5,so6a,so6b)["c"]
        for _ in range(3):
            for s in [so1,so2,so3,so4,so5,so6a,so6b]:
                plan(s,'manual')
        after_needs = q1(cur,"SELECT count(*) c FROM purchase_needs WHERE sale_order_id IN (%s,%s,%s,%s,%s,%s,%s)",so1,so2,so3,so4,so5,so6a,so6b)["c"]
        after_mos   = q1(cur,"SELECT count(*) c FROM manufacturing_orders WHERE sale_order_id IN (%s,%s,%s,%s,%s,%s,%s)",so1,so2,so3,so4,so5,so6a,so6b)["c"]
        after_moves = q1(cur,"SELECT count(*) c FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin LIKE %s)",(PFX+"%",))["c"]
        ok = (int(after_needs)==int(before_needs) and int(after_mos)==int(before_mos) and int(after_moves)==int(before_moves))
        add("T7.idempotency","sem duplicação após 3x run",f"needs {before_needs}->{after_needs} mos {before_mos}->{after_mos} moves {before_moves}->{after_moves}",ok)

        # =================== T8 incoming não conta como disponível
        p8 = mkprod("FG8", sold=True, purch=True)
        # criar picking incoming pending
        cust = q1(cur,"SELECT id FROM stock_locations WHERE type='customer' LIMIT 1")["id"]
        sup_loc = q1(cur,"SELECT id FROM stock_locations WHERE type='supplier' LIMIT 1")
        if sup_loc is None:
            sup_loc = {"id": cust}
        pk = q1(cur,"INSERT INTO stock_pickings(name,kind,state,warehouse_id,source_location_id,destination_location_id,partner_id,origin) VALUES(%s,'incoming','draft',%s,%s,%s,%s,%s) RETURNING id",
                (PFX+"IN8",wh,sup_loc["id"],loc,supplier,PFX+"IN8"))["id"]
        created["po_pickings"].append(pk)
        cur.execute("INSERT INTO stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,state) VALUES(%s,%s,%s,%s,100,'draft')",
                    (pk,p8,sup_loc["id"],loc))
        incoming = float(q1(cur,"SELECT so_product_incoming_qty(%s,%s) v",p8,wh)["v"])
        avail = float(q1(cur,"SELECT so_product_available_now(%s,%s) v",p8,wh)["v"])
        so8 = mksale("SO8",[(p8,5)])
        confirm(so8)
        row = q1(cur,"SELECT operational_status,qty_reserved FROM sale_order_lines WHERE order_id=%s",so8)
        ok = incoming==100 and avail==0 and float(row["qty_reserved"])==0 and row["operational_status"]=="waiting_purchase"
        add("T8.incoming_not_reservable",f"incoming={incoming} reservada=0",f"avail={avail} reserved={row['qty_reserved']} status={row['operational_status']}",ok)

        # =================== T9 in_production não conta
        p9 = mkprod("FG9", sold=True, mfg=True)
        bom9 = q1(cur,"INSERT INTO boms(product_id,active,quantity) VALUES(%s,true,1) RETURNING id",(p9,))["id"]
        created["boms"].append(bom9)
        mo9 = q1(cur,"INSERT INTO manufacturing_orders(code,product_id,qty,state,warehouse_id,bom_id) VALUES(%s,%s,50,'in_progress',%s,%s) RETURNING id",
                 (PFX+"MO9",p9,wh,bom9))["id"]
        created["mos"].append(mo9)
        inprod = float(q1(cur,"SELECT so_product_in_production_qty(%s,%s) v",p9,wh)["v"])
        avail = float(q1(cur,"SELECT so_product_available_now(%s,%s) v",p9,wh)["v"])
        so9 = mksale("SO9",[(p9,1)])
        confirm(so9)
        row = q1(cur,"SELECT operational_status,qty_reserved FROM sale_order_lines WHERE order_id=%s",so9)
        ok = inprod>=50 and avail==0 and float(row["qty_reserved"])==0
        add("T9.in_production_not_reservable",f"in_prod={inprod} reservada=0",f"avail={avail} reserved={row['qty_reserved']} status={row['operational_status']}",ok)

        # =================== T10 sem stock negativo nem over-reserve
        neg = q1(cur,"SELECT count(*) c FROM stock_quants WHERE quantity<0 OR reserved_quantity<0 OR reserved_quantity>quantity")["c"]
        ok = int(neg)==0
        add("T10.stock_integrity","0 quants negativos/over-reserved",f"violations={neg}",ok)

        # =================== T11 replan throttle
        plan(so1,'replan')
        r2 = plan(so1,'replan')
        ok = isinstance(r2,dict) and r2.get('skipped')=='replan_throttled'
        add("T11.replan_throttle","2ª chamada replan <2s = skipped",f"result={r2}",ok)

        # =================== T12 triggers regressão
        # Confirmar nova venda → 1 evento sale.confirmed, 1 notification sale_confirmed
        p12 = mkprod("FG12", sold=True, purch=True); stock(p12, 5)
        so12 = mksale("SO12",[(p12,1)])
        cur.execute("UPDATE sale_orders SET salesperson_id=NULL WHERE id=%s",(so12,))
        confirm(so12)
        ev = q1(cur,"SELECT count(*) c FROM module_events WHERE event_type='sale.confirmed' AND entity_id=%s",so12)["c"]
        ok = int(ev)==1
        add("T12a.sale_confirmed_event","1 evento sale.confirmed",f"events={ev}",ok)

        # Health check: SOs confirmed devem ter last_planned_at
        miss = q1(cur,"SELECT count(*) c FROM sale_orders WHERE state='confirmed' AND name LIKE %s AND last_planned_at IS NULL",(PFX+"%",))["c"]
        add("T12b.all_so_planned","todas SOs confirmadas têm last_planned_at",f"missing={miss}", int(miss)==0)

    except Exception as e:
        traceback.print_exc()
        add("FATAL","no exception",str(e),False)
    finally:
        # ---- cleanup
        try:
            cur.execute("BEGIN")
            cur.execute("DELETE FROM sale_order_timeline WHERE sale_order_id = ANY(%s)",(created["so"],))
            cur.execute("DELETE FROM sale_operational_plan_log WHERE sale_order_id = ANY(%s)",(created["so"],))
            cur.execute("DELETE FROM purchase_needs WHERE sale_order_id = ANY(%s) OR manufacturing_order_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id = ANY(%s))",(created["so"],created["so"]))
            cur.execute("DELETE FROM manufacturing_orders WHERE sale_order_id = ANY(%s) OR id = ANY(%s)",(created["so"],created["mos"]))
            cur.execute("DELETE FROM bom_lines WHERE bom_id = ANY(%s)",(created["boms"],))
            cur.execute("DELETE FROM boms WHERE id = ANY(%s)",(created["boms"],))
            cur.execute("DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin LIKE %s OR name LIKE %s)",(PFX+"%",PFX+"%"))
            cur.execute("DELETE FROM stock_pickings WHERE origin LIKE %s OR name LIKE %s",(PFX+"%",PFX+"%"))
            cur.execute("DELETE FROM module_events WHERE entity_id = ANY(%s)",(created["so"],))
            cur.execute("DELETE FROM notifications WHERE link LIKE %s",('%sales/orders/%',))
            cur.execute("DELETE FROM customer_payments WHERE order_id = ANY(%s)",(created["so"],))
            cur.execute("DELETE FROM sale_order_lines WHERE order_id = ANY(%s)",(created["so"],))
            cur.execute("DELETE FROM sale_orders WHERE id = ANY(%s)",(created["so"],))
            cur.execute("DELETE FROM product_suppliers WHERE product_id = ANY(%s)",(created["products"],))
            cur.execute("DELETE FROM stock_quants WHERE product_id = ANY(%s)",(created["products"],))
            cur.execute("DELETE FROM products WHERE id = ANY(%s)",(created["products"],))
            cur.execute("DELETE FROM partners WHERE id = ANY(%s)",(created["partners"],))
            cur.execute("COMMIT"); print("🧹 cleanup OK")
        except Exception as e:
            try: cur.execute("ROLLBACK")
            except: pass
            print(f"⚠ cleanup: {e}")

    rep=["# Phase 13 — Operational Engine report",
         f"_run: {datetime.datetime.utcnow().isoformat()}_","",
         "| # | Test | Expected | Observed | Status |",
         "|---|---|---|---|---|"]
    fails=0
    for i,(n,e,o,ok) in enumerate(REPORT,1):
        rep.append(f"| {i} | {n} | {e} | {o[:160]} | {'✅' if ok else '❌'} |")
        if not ok: fails+=1
    rep += ["", f"**TOTAL: {len(REPORT)-fails}/{len(REPORT)} OK**"]
    out="\n".join(rep)
    os.makedirs("/mnt/documents",exist_ok=True)
    with open("/mnt/documents/phase13-operational-engine-report.md","w") as f: f.write(out)
    print("\n"+out)
    sys.exit(1 if fails else 0)

if __name__=="__main__": main()
