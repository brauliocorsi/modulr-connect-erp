#!/usr/bin/env python3
"""
PHASE 1 — Stock reservation tests.

Validates:
  1. SO confirm + reserve_picking_strict  → reserved_quantity > 0, log='reserve'
  2. cancel_picking                       → reserved goes back to 0, stock unchanged, log='release'
  3. validate_picking                     → quantity decreases, reserved=0, log='consume'
  4. reserve_mo                           → mo_components.qty_reserved > 0, quants reserved
  5. release_mo_reservation               → idempotent, no negatives
  6. close_mo                             → components physical stock down, FG up, qty_reserved=0
  7. Idempotency                          → calling release twice never produces negatives
  8. No negative reserved_quantity anywhere

Cleans up TESTE_E2E_PH1_* at the end.
"""
import os, sys, ssl, datetime, traceback
import pg8000.dbapi as pg

_ctx = ssl.create_default_context(); _ctx.check_hostname=False; _ctx.verify_mode=ssl.CERT_NONE
PG = dict(host=os.environ["PGHOST"], port=int(os.environ.get("PGPORT", 5432)),
          user=os.environ["PGUSER"], password=os.environ["PGPASSWORD"],
          database=os.environ["PGDATABASE"], ssl_context=_ctx)

TS = datetime.datetime.utcnow().strftime("%H%M%S")
PFX = f"TESTE_E2E_PH1_{TS}_"
REPORT = []

def add(step, expected, observed, ok, risk=""):
    REPORT.append((step, expected, observed, ok, risk))
    icon = "✅" if ok else "❌"
    print(f"{icon} [{step}] {observed}")

def q(cur, sql, *args):
    cur.execute(sql, args); cols=[c[0] for c in cur.description]
    return [dict(zip(cols,r)) for r in cur.fetchall()]
def q1(cur, sql, *args):
    rows = q(cur, sql, *args); return rows[0] if rows else None
def x(cur, sql, *args):
    cur.execute(sql, args)

# ---------------------------------------------------------------------
def main():
    conn = pg.connect(**PG); conn.autocommit = True
    cur = conn.cursor()
    fg_id = comp_id = wh_id = loc_id = partner_id = None
    so_id = mo_id = picking_id = None
    try:
        # ===== SETUP =====
        # warehouse + internal location + partner
        wh = q1(cur, "SELECT id FROM warehouses WHERE active=true ORDER BY created_at LIMIT 1")
        wh_id = wh["id"]
        loc = q1(cur, "SELECT id FROM stock_locations WHERE warehouse_id=%s AND type='internal' AND active=true ORDER BY (parent_id IS NULL) DESC LIMIT 1", wh_id)
        loc_id = loc["id"]
        # finished good + component
        cur.execute("INSERT INTO products(name,type,active,can_be_sold,can_be_purchased) VALUES (%s,'storable',true,true,false) RETURNING id", (PFX+"FG",))
        fg_id = cur.fetchone()[0]
        cur.execute("INSERT INTO products(name,type,active,can_be_sold,can_be_purchased) VALUES (%s,'storable',true,false,true) RETURNING id", (PFX+"COMP",))
        comp_id = cur.fetchone()[0]
        # partner
        cur.execute("INSERT INTO partners(name,is_customer) VALUES (%s,true) RETURNING id", (PFX+"CUST",))
        partner_id = cur.fetchone()[0]
        # initial stock for component (50) and FG (10)
        x(cur, "INSERT INTO stock_quants(product_id,location_id,quantity) VALUES (%s,%s,50)", comp_id, loc_id)
        x(cur, "INSERT INTO stock_quants(product_id,location_id,quantity) VALUES (%s,%s,10)", fg_id, loc_id)
        add("setup", "warehouse+products+stock", f"wh={wh_id[:8]} fg={fg_id[:8]} comp={comp_id[:8]}", True)

        # ===== TEST 1: SO confirm → reserve_picking_strict =====
        # Build SO + outgoing picking + 1 move FG qty=3 manually (no UI triggers)
        cust_loc = q1(cur, "SELECT id FROM stock_locations WHERE type='customer' LIMIT 1")["id"]
        cur.execute("""INSERT INTO sale_orders(name,partner_id,state,warehouse_id,amount_total)
                       VALUES (%s,%s,'draft',%s,0) RETURNING id""", (PFX+"SO", partner_id, wh_id))
        so_id = cur.fetchone()[0]
        cur.execute("""INSERT INTO stock_pickings(name,kind,state,warehouse_id,source_location_id,destination_location_id,partner_id,origin)
                       VALUES (%s,'outgoing','draft',%s,%s,%s,%s,%s) RETURNING id""",
                    (PFX+"PICK", wh_id, loc_id, cust_loc, partner_id, PFX+"SO"))
        picking_id = cur.fetchone()[0]
        cur.execute("""INSERT INTO stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,state)
                       VALUES (%s,%s,%s,%s,3,'draft') RETURNING id""",
                    (picking_id, fg_id, loc_id, cust_loc))
        move_id = cur.fetchone()[0]

        # baseline
        before_q = q1(cur, "SELECT quantity, reserved_quantity FROM stock_quants WHERE product_id=%s AND location_id=%s", fg_id, loc_id)
        # call strict reserve
        x(cur, "SELECT reserve_picking_strict(%s)", picking_id)
        after_q = q1(cur, "SELECT quantity, reserved_quantity FROM stock_quants WHERE product_id=%s AND location_id=%s", fg_id, loc_id)
        ok = float(after_q["reserved_quantity"]) == 3 and float(after_q["quantity"]) == float(before_q["quantity"])
        add("T1.reserve_picking_strict", "reserved_quantity=3 quantity unchanged",
            f"qty {before_q['quantity']}→{after_q['quantity']}, res {before_q['reserved_quantity']}→{after_q['reserved_quantity']}", ok)
        # log
        log = q1(cur, "SELECT count(*) c FROM stock_reservation_log WHERE origin_type='PICKING' AND origin_id=%s AND action='reserve'", picking_id)
        add("T1.log.reserve", ">=1 reserve row", f"count={log['c']}", int(log["c"])>=1)

        # ===== TEST 2: cancel_picking → release =====
        x(cur, "SELECT cancel_picking(%s,true)", picking_id)
        rel_q = q1(cur, "SELECT quantity, reserved_quantity FROM stock_quants WHERE product_id=%s AND location_id=%s", fg_id, loc_id)
        ok = float(rel_q["reserved_quantity"]) == 0 and float(rel_q["quantity"]) == float(before_q["quantity"])
        add("T2.cancel_picking", "reserved=0 quantity unchanged",
            f"qty={rel_q['quantity']} res={rel_q['reserved_quantity']}", ok)
        log_rel = q1(cur, "SELECT count(*) c FROM stock_reservation_log WHERE origin_type='PICKING' AND origin_id=%s AND action='release'", picking_id)
        add("T2.log.release", ">=1 release row", f"count={log_rel['c']}", int(log_rel["c"])>=1)

        # ===== TEST 3: idempotency — call release_move on cancelled move twice =====
        cur.execute("SELECT id FROM stock_moves WHERE picking_id=%s LIMIT 1", (picking_id,))
        mv = cur.fetchone()
        if mv:
            x(cur, "SELECT release_move_reservation(%s)", mv[0])
            x(cur, "SELECT release_move_reservation(%s)", mv[0])
        neg = q1(cur, "SELECT count(*) c FROM stock_quants WHERE reserved_quantity < 0")
        add("T3.idempotency", "no negative reserved_quantity", f"negatives={neg['c']}", int(neg["c"])==0)

        # ===== TEST 4: validate_picking → consume =====
        # Recreate a fresh picking for the same FG
        cur.execute("""INSERT INTO stock_pickings(name,kind,state,warehouse_id,source_location_id,destination_location_id,partner_id,origin)
                       VALUES (%s,'outgoing','draft',%s,%s,%s,%s,%s) RETURNING id""",
                    (PFX+"PICK2", wh_id, loc_id, cust_loc, partner_id, PFX+"SO"))
        pk2 = cur.fetchone()[0]
        cur.execute("""INSERT INTO stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,state)
                       VALUES (%s,%s,%s,%s,2,'draft')""", (pk2, fg_id, loc_id, cust_loc))
        x(cur, "SELECT reserve_picking_strict(%s)", pk2)
        before2 = q1(cur, "SELECT quantity, reserved_quantity FROM stock_quants WHERE product_id=%s AND location_id=%s", fg_id, loc_id)
        x(cur, "SELECT validate_picking(%s)", pk2)
        after2 = q1(cur, "SELECT quantity, reserved_quantity FROM stock_quants WHERE product_id=%s AND location_id=%s", fg_id, loc_id)
        ok = float(before2["quantity"]) - float(after2["quantity"]) == 2 and float(after2["reserved_quantity"]) == 0
        add("T4.validate_picking", "quantity -2, reserved=0",
            f"qty {before2['quantity']}→{after2['quantity']} res {before2['reserved_quantity']}→{after2['reserved_quantity']}", ok)
        cons = q1(cur, "SELECT count(*) c FROM stock_reservation_log WHERE origin_type='PICKING' AND origin_id=%s AND action='consume'", pk2)
        add("T4.log.consume", ">=1 consume row", f"count={cons['c']}", int(cons["c"])>=1)

        # ===== TEST 5+6: MO reserve + close =====
        # Need a BOM minimal: simulate by directly inserting MO + mo_components
        cur.execute("""INSERT INTO manufacturing_orders(code,product_id,qty,state,warehouse_id)
                       VALUES (%s,%s,2,'draft',%s) RETURNING id""", (PFX+"MO", fg_id, wh_id))
        mo_id = cur.fetchone()[0]
        cur.execute("""INSERT INTO mo_components(mo_id,product_id,qty_required,status,sequence)
                       VALUES (%s,%s,4,'pending',1)""", (mo_id, comp_id))
        # baseline component
        b_comp = q1(cur, "SELECT quantity, reserved_quantity FROM stock_quants WHERE product_id=%s AND location_id=%s", comp_id, loc_id)
        # transitioning state to ready triggers reserve_mo
        x(cur, "UPDATE manufacturing_orders SET state='ready' WHERE id=%s", mo_id)
        a_comp = q1(cur, "SELECT quantity, reserved_quantity FROM stock_quants WHERE product_id=%s AND location_id=%s", comp_id, loc_id)
        mc = q1(cur, "SELECT qty_reserved, qty_consumed FROM mo_components WHERE mo_id=%s", mo_id)
        ok = float(a_comp["reserved_quantity"]) == 4 and float(a_comp["quantity"]) == float(b_comp["quantity"]) and float(mc["qty_reserved"]) == 4
        add("T5.reserve_mo", "comp reserved=4 qty unchanged, mo_components.qty_reserved=4",
            f"qty {b_comp['quantity']}→{a_comp['quantity']} res {b_comp['reserved_quantity']}→{a_comp['reserved_quantity']} mc.res={mc['qty_reserved']}", ok)

        # FG baseline
        b_fg = q1(cur, "SELECT quantity FROM stock_quants WHERE product_id=%s AND location_id=%s", fg_id, loc_id)
        # close_mo
        x(cur, "SELECT close_mo(%s, NULL)", mo_id)
        a_comp2 = q1(cur, "SELECT quantity, reserved_quantity FROM stock_quants WHERE product_id=%s AND location_id=%s", comp_id, loc_id)
        a_fg = q1(cur, "SELECT quantity FROM stock_quants WHERE product_id=%s AND location_id=%s", fg_id, loc_id)
        mc2 = q1(cur, "SELECT qty_reserved, qty_consumed FROM mo_components WHERE mo_id=%s", mo_id)
        mo_state = q1(cur, "SELECT state::text FROM manufacturing_orders WHERE id=%s", mo_id)["state"]
        ok = (float(b_comp["quantity"]) - float(a_comp2["quantity"])) == 4 \
             and float(a_comp2["reserved_quantity"]) == 0 \
             and (float(a_fg["quantity"]) - float(b_fg["quantity"])) == 2 \
             and float(mc2["qty_reserved"]) == 0 \
             and float(mc2["qty_consumed"]) == 4 \
             and mo_state == "done"
        add("T6.close_mo", "comp -4, fg +2, qty_reserved=0, qty_consumed=4, state=done",
            f"comp {b_comp['quantity']}→{a_comp2['quantity']} fg {b_fg['quantity']}→{a_fg['quantity']} mc.res={mc2['qty_reserved']} mc.cons={mc2['qty_consumed']} state={mo_state}", ok)

        # log consume for MO
        mo_log = q1(cur, "SELECT count(*) c FROM stock_reservation_log WHERE origin_type='MO' AND origin_id=%s AND action='consume'", mo_id)
        add("T6.log.consume_mo", ">=2 consume rows (component+FG)", f"count={mo_log['c']}", int(mo_log["c"])>=2)

        # ===== TEST 7: idempotency release_mo on already-consumed MO =====
        x(cur, "SELECT release_mo_reservation(%s)", mo_id)
        x(cur, "SELECT release_mo_reservation(%s)", mo_id)
        neg2 = q1(cur, "SELECT count(*) c FROM stock_quants WHERE reserved_quantity < 0")
        add("T7.idempotency_mo", "no negatives after double release", f"negatives={neg2['c']}", int(neg2["c"])==0)

        # ===== TEST 8: reserve_picking_strict blocks when insufficient =====
        cur.execute("""INSERT INTO stock_pickings(name,kind,state,warehouse_id,source_location_id,destination_location_id,partner_id,origin)
                       VALUES (%s,'outgoing','draft',%s,%s,%s,%s,%s) RETURNING id""",
                    (PFX+"PICK_BIG", wh_id, loc_id, cust_loc, partner_id, PFX+"SO"))
        pk3 = cur.fetchone()[0]
        cur.execute("""INSERT INTO stock_moves(picking_id,product_id,source_location_id,destination_location_id,quantity,state)
                       VALUES (%s,%s,%s,%s,9999,'draft')""", (pk3, fg_id, loc_id, cust_loc))
        blocked = False
        try: x(cur, "SELECT reserve_picking_strict(%s)", pk3)
        except Exception as e: blocked = "Stock insuficiente" in str(e)
        add("T8.strict_block", "raises on insufficient stock", f"blocked={blocked}", blocked)

    except Exception as e:
        traceback.print_exc()
        add("FATAL", "no exception", str(e), False, "fluxo abortado")
    finally:
        # ---- CLEANUP ----
        try:
            cur.execute("BEGIN")
            cur.execute("DELETE FROM mo_components WHERE mo_id IN (SELECT id FROM manufacturing_orders WHERE code LIKE %s)", (PFX+"%",))
            cur.execute("DELETE FROM manufacturing_orders WHERE code LIKE %s", (PFX+"%",))
            cur.execute("DELETE FROM stock_moves WHERE picking_id IN (SELECT id FROM stock_pickings WHERE name LIKE %s)", (PFX+"%",))
            cur.execute("DELETE FROM stock_pickings WHERE name LIKE %s", (PFX+"%",))
            cur.execute("DELETE FROM sale_orders WHERE name LIKE %s", (PFX+"%",))
            cur.execute("DELETE FROM stock_quants WHERE product_id IN (SELECT id FROM products WHERE name LIKE %s)", (PFX+"%",))
            cur.execute("DELETE FROM products WHERE name LIKE %s", (PFX+"%",))
            cur.execute("DELETE FROM partners WHERE name LIKE %s", (PFX+"%",))
            cur.execute("COMMIT")
            print("🧹 cleanup OK")
        except Exception as e:
            print(f"⚠ cleanup error: {e}")
            try: cur.execute("ROLLBACK")
            except: pass

    # ---- REPORT ----
    rep = ["# Phase 1 — Reservations test report", f"_run: {datetime.datetime.utcnow().isoformat()}_", "",
           "| # | Step | Expected | Observed | Status |", "|---|------|----------|----------|--------|"]
    fails = 0
    for i,(s,e_,o,ok,risk) in enumerate(REPORT,1):
        rep.append(f"| {i} | {s} | {e_} | {o[:140]} | {'✅' if ok else '❌'} |")
        if not ok: fails += 1
    rep += ["", f"**TOTAL: {len(REPORT)-fails}/{len(REPORT)} OK**"]
    out = "\n".join(rep)
    os.makedirs("/mnt/documents", exist_ok=True)
    with open("/mnt/documents/phase1-reservations-report.md","w") as f: f.write(out)
    print("\n"+out)
    sys.exit(1 if fails else 0)

if __name__ == "__main__": main()
