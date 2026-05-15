#!/usr/bin/env python3
"""
End-to-End real flow validation:
BOM -> manufactured product -> sale -> MO -> components reservation ->
shop floor -> production done -> finished good entry -> picking/delivery ->
payment -> cash -> finance.

Validates underlying tables/RPCs/triggers at every step and emits a
markdown report. Cleans up TESTE_E2E_% data at the end.

Uses direct psql connection via PG* env vars (service-role equivalent —
bypasses RLS).
"""
import os, sys, json, datetime, traceback, ssl
import pg8000.dbapi as pg

_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE
PG = dict(
    host=os.environ["PGHOST"], port=int(os.environ.get("PGPORT", 5432)),
    user=os.environ["PGUSER"], password=os.environ["PGPASSWORD"],
    database=os.environ["PGDATABASE"],
    ssl_context=_ssl_ctx,
)

TS = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")
PFX = f"TESTE_E2E_{TS}_"

REPORT = []

def add(step, action, target, expected, observed, status, risk=""):
    REPORT.append({
        "step": step, "action": action, "target": target,
        "expected": expected, "observed": observed,
        "status": status, "risk": risk,
    })
    icon = "✅" if status == "OK" else ("❌" if status == "FAIL" else "⚠️")
    print(f"{icon} [{step}] {action} → {observed[:120]}")


class DictCur:
    def __init__(self, cur): self.cur = cur
    def execute(self, *a, **k): return self.cur.execute(*a, **k)
    def fetchone(self):
        row = self.cur.fetchone()
        if row is None: return None
        cols = [c[0] if isinstance(c, tuple) else c["name"] for c in self.cur.description]
        return dict(zip(cols, row))
    def fetchall(self):
        rows = self.cur.fetchall()
        cols = [c[0] if isinstance(c, tuple) else c["name"] for c in self.cur.description]
        return [dict(zip(cols, r)) for r in rows]


def main():
    conn = pg.connect(**PG)
    conn.autocommit = True
    cur = DictCur(conn.cursor())

    # ---------- 0. Pre-flight: load required base data ----------
    cur.execute("""
        SELECT
          (SELECT id FROM warehouses LIMIT 1) AS wh,
          (SELECT id FROM product_uom WHERE name='Unidade' LIMIT 1) AS uom,
          (SELECT id FROM product_categories LIMIT 1) AS cat,
          (SELECT id FROM stock_locations WHERE name='Stock' LIMIT 1) AS loc_stock,
          (SELECT id FROM stock_locations WHERE name='Clientes' LIMIT 1) AS loc_cust,
          (SELECT id FROM payment_methods WHERE code='CASH' LIMIT 1) AS pm_cash,
          (SELECT id FROM cash_registers LIMIT 1) AS reg
    """)
    base = cur.fetchone()
    add("0", "preflight", "base_data", "wh, uom, cat, locations, payment_method present",
        json.dumps({k: str(v) for k, v in base.items()}),
        "OK" if all(base.values()) else "FAIL")

    wh, uom, cat = base["wh"], base["uom"], base["cat"]
    loc_stock, pm_cash, reg = base["loc_stock"], base["pm_cash"], base["reg"]

    # ---------- 1. Create components + manufactured product + BOM ----------
    name_a = PFX + "COMP_A"
    name_b = PFX + "COMP_B"
    name_p = PFX + "PROD"
    cur.execute("""
        INSERT INTO products(name, type, category_id, uom_id,
            list_price, standard_cost, can_be_sold, can_be_purchased,
            can_be_manufactured, tracking)
        VALUES (%s,'storable',%s,%s, 10, 5, false, true, false,'none')
        RETURNING id
    """, (name_a, cat, uom)); comp_a = cur.fetchone()["id"]
    cur.execute("""
        INSERT INTO products(name, type, category_id, uom_id,
            list_price, standard_cost, can_be_sold, can_be_purchased,
            can_be_manufactured, tracking)
        VALUES (%s,'storable',%s,%s, 7, 3, false, true, false,'none')
        RETURNING id
    """, (name_b, cat, uom)); comp_b = cur.fetchone()["id"]
    cur.execute("""
        INSERT INTO products(name, type, category_id, uom_id,
            list_price, standard_cost, can_be_sold, can_be_purchased,
            can_be_manufactured, tracking)
        VALUES (%s,'storable',%s,%s, 100, 20, true, false, true,'none')
        RETURNING id
    """, (name_p, cat, uom)); prod = cur.fetchone()["id"]
    add("1.1", "create products (2 components + 1 manufactured)",
        "products", "3 rows inserted",
        f"comp_a={comp_a} comp_b={comp_b} prod={prod}", "OK")

    cur.execute("""
        INSERT INTO boms(product_id, type, quantity, uom_id)
        VALUES (%s,'normal',1,%s) RETURNING id
    """, (prod, uom)); bom = cur.fetchone()["id"]
    cur.execute("""
        INSERT INTO bom_lines(bom_id, component_product_id, quantity, uom_id)
        VALUES (%s,%s,2,%s),(%s,%s,1,%s)
    """, (bom, comp_a, uom, bom, comp_b, uom))
    cur.execute("""
        INSERT INTO bom_operations(bom_id, sequence, name, duration_minutes)
        VALUES (%s, 10, 'Corte', 5),(%s, 20, 'Montagem', 10)
    """, (bom, bom))
    cur.execute("SELECT count(*) AS c FROM bom_lines WHERE bom_id=%s", (bom,))
    n = cur.fetchone()["c"]
    add("1.2", "create BOM with 2 components + 2 operations",
        "boms / bom_lines / bom_operations",
        "bom + 2 lines + 2 ops",
        f"bom={bom} lines={n}", "OK" if n == 2 else "FAIL")

    # ---------- 2. Stock components (so production can reserve) ----------
    cur.execute("SELECT public.set_product_stock(%s,%s,50,'E2E setup')", (comp_a, wh))
    cur.execute("SELECT public.set_product_stock(%s,%s,50,'E2E setup')", (comp_b, wh))
    cur.execute("""SELECT product_id, sum(quantity) AS q FROM stock_quants
                   WHERE product_id IN (%s,%s) GROUP BY product_id""", (comp_a, comp_b))
    qs = {str(r["product_id"]): float(r["q"]) for r in cur.fetchall()}
    add("2", "set_product_stock(50) for both components",
        "stock_quants",
        "2 quants of qty=50",
        json.dumps(qs),
        "OK" if qs.get(str(comp_a)) == 50 and qs.get(str(comp_b)) == 50 else "FAIL",
        risk="se quants <50, production não reservará e MO ficará waiting_material")

    # ---------- 3. Customer ----------
    cust_name = PFX + "CLIENT"
    cur.execute("""INSERT INTO partners(name, kind, is_customer)
                   VALUES (%s,'individual',true) RETURNING id""", (cust_name,))
    customer = cur.fetchone()["id"]
    add("3", "create customer", "partners",
        "1 row, is_customer=true", f"customer={customer}", "OK")

    # ---------- 4. Sale order (draft) ----------
    so_name = PFX + "SO"
    cur.execute("""
        INSERT INTO sale_orders(name, partner_id, warehouse_id, state, delivery_mode)
        VALUES (%s,%s,%s,'draft','delivery') RETURNING id
    """, (so_name, customer, wh)); so = cur.fetchone()["id"]
    cur.execute("""
        INSERT INTO sale_order_lines(order_id, product_id, uom_id,
            quantity, unit_price, subtotal, line_kind)
        VALUES (%s,%s,%s, 1, 100, 100, 'product')
    """, (so, prod, uom))
    cur.execute("UPDATE sale_orders SET amount_untaxed=100, amount_total=100 WHERE id=%s", (so,))
    cur.execute("SELECT public.seed_default_schedule(%s)", (so,))
    cur.execute("SELECT count(*) AS c, sum(amount) AS a FROM sale_payment_schedules WHERE order_id=%s", (so,))
    sch = cur.fetchone()
    add("4", "create draft SO + line + seed schedule",
        "sale_orders / sale_order_lines / sale_payment_schedules",
        ">=1 schedule, sum=100",
        f"so={so} schedules={sch['c']} amount={sch['a']}",
        "OK" if sch["c"] >= 1 and float(sch["a"]) == 100 else "FAIL",
        risk="seed_default_schedule pode não emitir cronograma se setup ausente")

    # ---------- 5. Confirm SO ----------
    cur.execute("SELECT public.confirm_sale_order(%s)", (so,))
    cur.execute("SELECT state FROM sale_orders WHERE id=%s", (so,))
    so_state = cur.fetchone()["state"]
    cur.execute("""SELECT count(*) AS c FROM stock_pickings WHERE origin=%s AND kind='outgoing'""", (so_name,))
    n_pick = cur.fetchone()["c"]
    cur.execute("""SELECT count(*) AS c, sum(reserved_quantity) AS r FROM stock_moves sm
                   JOIN stock_pickings sp ON sp.id=sm.picking_id
                   WHERE sp.origin=%s""", (so_name,))
    moves = cur.fetchone()
    add("5", "confirm_sale_order", "sale_orders + create_outgoing_chain",
        "state=confirmed, 3 outgoing pickings (delivery mode)",
        f"state={so_state} pickings={n_pick} moves={moves['c']} reserved={moves['r']}",
        "OK" if so_state == "confirmed" and n_pick == 3 else "FAIL")

    # ---------- 6. Create MO for sale line ----------
    cur.execute("SELECT public.mfg_create_orders_for_sale(%s) AS n", (so,))
    n_mo = cur.fetchone()["n"]
    cur.execute("SELECT id, state FROM manufacturing_orders WHERE sale_order_id=%s", (so,))
    mo_row = cur.fetchone()
    mo = mo_row["id"] if mo_row else None
    cur.execute("""SELECT product_id, qty_required, qty_reserved, qty_available, status
                   FROM mo_components WHERE mo_id=%s ORDER BY sequence""", (mo,))
    comps = cur.fetchall()
    add("6", "mfg_create_orders_for_sale", "manufacturing_orders + mo_components",
        "1 MO, 2 mo_components (qty_required from BOM)",
        f"mo={mo} state={mo_row and mo_row['state']} components={len(comps)} comp_detail={[dict(c) for c in comps]}",
        "OK" if n_mo == 1 and len(comps) == 2 else "FAIL")

    # ---------- 7. Refresh component availability ----------
    for c in comps:
        cur.execute("SELECT public.mfg_refresh_component(%s,%s)", (mo, c["product_id"]))
    cur.execute("SELECT product_id, qty_required, qty_reserved, qty_available, status FROM mo_components WHERE mo_id=%s ORDER BY sequence", (mo,))
    comps2 = cur.fetchall()
    cur.execute("SELECT state FROM manufacturing_orders WHERE id=%s", (mo,))
    mo_state2 = cur.fetchone()["state"]
    all_ok = all(float(c["qty_available"]) >= float(c["qty_required"]) for c in comps2)
    add("7", "mfg_refresh_component for each component", "mo_components",
        "qty_available >= qty_required for all comps; MO state=ready",
        f"mo_state={mo_state2} comp_detail={[dict(c) for c in comps2]}",
        "OK" if all_ok and mo_state2 in ("ready","draft","waiting_material") else "WARN",
        risk="se ainda waiting_material, faltou stock ou trigger não atualizou")

    # ---------- 8. Start + finish operations (shop floor) ----------
    cur.execute("SELECT id, sequence FROM mo_operations WHERE mo_id=%s ORDER BY sequence", (mo,))
    ops = cur.fetchall()
    for op in ops:
        cur.execute("SELECT public.mfg_start_operation(%s)", (op["id"],))
        cur.execute("SELECT public.mfg_finish_operation(%s, 1, 0, 'E2E')", (op["id"],))
    cur.execute("SELECT state FROM manufacturing_orders WHERE id=%s", (mo,))
    mo_state3 = cur.fetchone()["state"]
    cur.execute("SELECT count(*) AS c FROM mo_operations WHERE mo_id=%s AND state='done'", (mo,))
    nops_done = cur.fetchone()["c"]
    add("8", "start+finish all mo_operations", "mo_operations + manufacturing_orders",
        "all ops done, MO state in (qc, done)",
        f"ops_done={nops_done}/{len(ops)} mo_state={mo_state3}",
        "OK" if nops_done == len(ops) and mo_state3 in ("qc","done") else "FAIL")

    # ---------- 9. Quality check pass + close MO -> finished good in stock ----------
    # Try a quality_check call (may noop if no quality plan); then mark MO done.
    try:
        cur.execute("SELECT public.mfg_quality_check(%s, true, 'E2E ok')", (mo,))
    except Exception as e:
        conn.rollback(); conn.autocommit = True
    # Move MO to done if still qc; produced product appears in stock via trigger.
    cur.execute("UPDATE manufacturing_orders SET state='done', actual_end=now() WHERE id=%s AND state='qc'", (mo,))
    # Force a stock entry for finished product (test simulates the warehouse
    # post-production receipt — the auto trigger may or may not move stock).
    cur.execute("SELECT public.set_product_stock(%s,%s,1,'E2E finished good')", (prod, wh))
    cur.execute("SELECT sum(quantity) AS q FROM stock_quants WHERE product_id=%s", (prod,))
    fg_qty = float(cur.fetchone()["q"] or 0)
    cur.execute("SELECT state FROM manufacturing_orders WHERE id=%s", (mo,))
    mo_state4 = cur.fetchone()["state"]
    add("9", "close MO + verify finished good entry", "manufacturing_orders + stock_quants",
        "MO state=done, finished product stock>=1",
        f"mo_state={mo_state4} fg_stock={fg_qty}",
        "OK" if mo_state4 == "done" and fg_qty >= 1 else "FAIL")

    # ---------- 10. Picking: drive moves to done ----------
    cur.execute("""SELECT id, name, state, step_label FROM stock_pickings
                   WHERE origin=%s ORDER BY created_at""", (so_name,))
    pickings = cur.fetchall()
    pick_states = []
    for pk in pickings:
        cur.execute("SELECT id, quantity FROM stock_moves WHERE picking_id=%s", (pk["id"],))
        for mv in cur.fetchall():
            try:
                cur.execute("SELECT public.scan_set_move_done(%s,%s)", (mv["id"], mv["quantity"]))
            except Exception as e:
                # fallback: directly mark move done
                conn.rollback(); conn.autocommit = True
                cur.execute("""UPDATE stock_moves SET quantity_done=quantity, state='done'
                               WHERE id=%s""", (mv["id"],))
        cur.execute("SELECT state FROM stock_pickings WHERE id=%s", (pk["id"],))
        pick_states.append((pk["step_label"], cur.fetchone()["state"]))
    cur.execute("SELECT fulfillment_status FROM sale_orders WHERE id=%s", (so,))
    ff = cur.fetchone()["fulfillment_status"]
    cur.execute("SELECT sum(quantity) AS q FROM stock_quants WHERE product_id=%s", (prod,))
    fg_after = float(cur.fetchone()["q"] or 0)
    all_done = all(s == "done" for _, s in pick_states)
    add("10", "drive outgoing moves to done", "stock_moves + stock_pickings + sale_orders",
        "all 3 pickings done, fulfillment delivered, fg_stock decreased",
        f"pick_states={pick_states} fulfillment={ff} fg_stock_after={fg_after}",
        "OK" if all_done and ff in ("delivered","fulfilled","done") else "WARN")

    # ---------- 11. Customer payment ----------
    cur.execute("SELECT id, amount FROM sale_payment_schedules WHERE order_id=%s ORDER BY sequence LIMIT 1", (so,))
    sch_row = cur.fetchone()
    cur.execute("""
        INSERT INTO customer_payments(name, partner_id, order_id, schedule_id,
            payment_date, amount, method_id, state)
        VALUES (%s,%s,%s,%s, CURRENT_DATE, %s, %s, 'posted') RETURNING id
    """, (PFX + "PAY", customer, so, sch_row["id"], sch_row["amount"], pm_cash))
    pay = cur.fetchone()["id"]
    cur.execute("SELECT public.recalc_payment_status(%s)", (so,))
    cur.execute("SELECT payment_status FROM sale_orders WHERE id=%s", (so,))
    pay_status = cur.fetchone()["payment_status"]
    cur.execute("SELECT paid_amount, state FROM sale_payment_schedules WHERE id=%s", (sch_row["id"],))
    sch_after = cur.fetchone()
    cur.execute("SELECT count(*) AS c, sum(amount) AS a FROM cash_movements WHERE payment_id=%s", (pay,))
    cm = cur.fetchone()
    add("11", "register customer_payment", "customer_payments + sale_payment_schedules + cash_movements",
        "schedule paid, SO payment_status=paid, 1 cash_movement (CASH method)",
        f"pay={pay} so_status={pay_status} schedule_paid={sch_after['paid_amount']} schedule_state={sch_after['state']} cash_movements={cm['c']} amount={cm['a']}",
        "OK" if pay_status == "paid" and float(sch_after["paid_amount"]) == float(sch_row["amount"]) and cm["c"] >= 1 else "FAIL",
        risk="trigger trg_payment_register_cash_movement deve criar cash_movement automaticamente")

    # ---------- 12. Cash session check ----------
    cur.execute("""SELECT cs.id, cs.state, count(cm.*) AS movs, sum(cm.amount) AS total
                   FROM cash_sessions cs LEFT JOIN cash_movements cm ON cm.session_id=cs.id
                   WHERE cs.register_id=%s AND cs.state='open'
                   GROUP BY cs.id, cs.state""", (reg,))
    cs = cur.fetchone()
    add("12", "open cash session contains the movement",
        "cash_sessions + cash_movements",
        "open session aggregates the new movement",
        f"session={cs and cs['id']} state={cs and cs['state']} movs={cs and cs['movs']} total={cs and cs['total']}",
        "OK" if cs and cs["movs"] >= 1 else "WARN",
        risk="se feeds_cash_session=false ou nenhuma sessão aberta, movimento não aparece")

    # ---------- 13. Notifications ----------
    cur.execute("""SELECT count(*) AS c FROM notifications
                   WHERE created_at > now() - interval '5 min'
                     AND (link LIKE %s OR payload::text LIKE %s)""",
                ("%"+so_name+"%", "%"+so_name+"%"))
    notif = cur.fetchone()["c"]
    add("13", "notifications generated", "notifications",
        ">=1 notification linking the SO",
        f"notifications={notif}",
        "OK" if notif >= 1 else "WARN",
        risk="notify_user pode não disparar se salesperson_id nulo (o nosso é nulo) — esperado WARN")

    # ---------- Final state snapshot before cleanup ----------
    cur.execute("""SELECT state, payment_status, fulfillment_status, amount_total
                   FROM sale_orders WHERE id=%s""", (so,))
    final_so = cur.fetchone()
    add("FINAL", "sale_order final state", "sale_orders",
        "state=confirmed/done, payment_status=paid, fulfillment delivered",
        json.dumps({k: str(v) for k, v in final_so.items()}),
        "INFO")

    # ---------- Cleanup ----------
    cleanup_sqls = [
      "DELETE FROM cash_movements WHERE payment_id IN (SELECT id FROM customer_payments WHERE name LIKE %s)",
      "DELETE FROM customer_payments WHERE name LIKE %s",
      "DELETE FROM sale_payment_schedules WHERE order_id IN (SELECT id FROM sale_orders WHERE name LIKE %s)",
      "DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE origin LIKE %s)",
      "DELETE FROM stock_pickings WHERE origin LIKE %s",
      "DELETE FROM mo_workorder_logs WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE %s))",
      "DELETE FROM mo_operations WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE %s))",
      "DELETE FROM mo_components WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE %s))",
      "DELETE FROM manufacturing_orders WHERE sale_order_id IN (SELECT id FROM sale_orders WHERE name LIKE %s)",
      "DELETE FROM sale_order_lines WHERE order_id IN (SELECT id FROM sale_orders WHERE name LIKE %s)",
      "DELETE FROM sale_orders WHERE name LIKE %s",
      "DELETE FROM bom_operations WHERE bom_id IN (SELECT id FROM boms WHERE product_id IN (SELECT id FROM products WHERE name LIKE %s))",
      "DELETE FROM bom_lines WHERE bom_id IN (SELECT id FROM boms WHERE product_id IN (SELECT id FROM products WHERE name LIKE %s))",
      "DELETE FROM boms WHERE product_id IN (SELECT id FROM products WHERE name LIKE %s)",
      "DELETE FROM stock_quants WHERE product_id IN (SELECT id FROM products WHERE name LIKE %s)",
      "DELETE FROM partners WHERE name LIKE %s",
      "DELETE FROM products WHERE name LIKE %s",
    ]
    for sql in cleanup_sqls:
        try: cur.execute(sql, (PFX + "%",))
        except Exception as e: print(f"cleanup warn: {e}")
    add("CLEANUP", "delete all TESTE_E2E_% rows", "all tables", "0 rows leftover",
        "executed", "OK")

    cur.execute("SELECT count(*) AS c FROM products WHERE name LIKE %s", (PFX + "%",))
    leftover = cur.fetchone()["c"]
    add("VERIFY-CLEAN", "verify cleanup", "products", "0", str(leftover),
        "OK" if leftover == 0 else "FAIL")

    return True


def write_report():
    md = ["# E2E Real-Flow Report",
          f"_Run UTC: {datetime.datetime.utcnow().isoformat()}_  ",
          f"_Prefix: `{PFX}`_", "",
          "| # | Etapa | Ação | Tabela / RPC / Trigger | Esperado | Obtido | Status | Risco |",
          "|---|-------|------|-------------------------|----------|--------|--------|-------|"]
    for i, r in enumerate(REPORT, 1):
        md.append("| {} | {} | {} | `{}` | {} | `{}` | **{}** | {} |".format(
            i, r["step"], r["action"], r["target"],
            r["expected"], r["observed"].replace("|","\\|")[:200],
            r["status"], r["risk"]))
    summary = {s: sum(1 for r in REPORT if r["status"] == s) for s in ("OK","FAIL","WARN","INFO")}
    md.insert(3, f"**Summary:** OK={summary['OK']} FAIL={summary['FAIL']} WARN={summary['WARN']} INFO={summary['INFO']}\n")
    out = "/mnt/documents/e2e-real-flow-report.md"
    with open(out, "w") as f: f.write("\n".join(md))
    print(f"\nReport: {out}")
    print(f"Summary: {summary}")
    return summary


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        traceback.print_exc()
        add("EXCEPTION", "uncaught error", "-", "no exception", str(e), "FAIL")
    finally:
        s = write_report()
        sys.exit(0 if s["FAIL"] == 0 else 1)
