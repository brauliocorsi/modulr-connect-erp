// Demo end-to-end flow: sale → purchase → receive → internal transfers (dock → vehicle) → payment → delivery
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Step = {
  key: string;
  title: string;
  status: "ok" | "skip" | "error";
  detail?: string;
  link?: { label: string; to: string };
  data?: Record<string, unknown>;
  ms?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const paymentMode: "full_on_sale" | "split_50_50" = body.payment_mode ?? "full_on_sale";
  const steps: Step[] = [];

  const t0 = (label: string) => {
    const start = Date.now();
    return (s: Omit<Step, "ms">) => steps.push({ ...s, ms: Date.now() - start });
  };

  try {
    // ── 0. Pre-reqs ───────────────────────────────────────────────────────────
    let push = t0("setup");
    const { data: wh } = await supa.from("warehouses").select("id, name").eq("active", true).limit(1).maybeSingle();
    const { data: locStock } = await supa.from("stock_locations").select("id").eq("warehouse_id", wh!.id).eq("name", "Stock").maybeSingle();
    const { data: locCais } = await supa.from("stock_locations").select("id").eq("warehouse_id", wh!.id).eq("name", "Cais de Carga").maybeSingle();
    const { data: locCarr } = await supa.from("stock_locations").select("id").eq("warehouse_id", wh!.id).eq("name", "Zona Carrinha").maybeSingle();
    const { data: prod } = await supa.from("products").select("id, name").eq("active", true).eq("can_be_sold", true).limit(1).maybeSingle();
    const { data: customer } = await supa.from("partners").select("id, name").eq("is_customer", true).eq("active", true).limit(1).maybeSingle();
    const { data: supplier } = await supa.from("partners").select("id, name").eq("is_supplier", true).eq("active", true).limit(1).maybeSingle();
    const { data: vehicle } = await supa.from("vehicles").select("id, name, license_plate").eq("active", true).limit(1).maybeSingle();
    const { data: method } = await supa.from("payment_methods").select("id, name, default_journal_id").eq("code", "CASH").maybeSingle();

    if (!wh || !prod || !customer || !supplier || !vehicle || !method || !locStock || !locCais || !locCarr) {
      throw new Error(`Pré-requisitos em falta — warehouse=${!!wh} product=${!!prod} customer=${!!customer} supplier=${!!supplier} vehicle=${!!vehicle} method=${!!method} locs=${!!locStock && !!locCais && !!locCarr}`);
    }
    push({ key: "setup", title: "Pré-requisitos", status: "ok",
      detail: `Cliente: ${customer.name} · Fornecedor: ${supplier.name} · Produto: ${prod.name} · Carrinha: ${vehicle.name} (${vehicle.license_plate})` });

    const PRICE = 200;
    const COST = 80;

    // ── 1. Compra ao fornecedor ───────────────────────────────────────────────
    push = t0("po");
    const { data: poSeq } = await supa.rpc("next_sequence", { _code: "purchase_order" });
    const { data: po, error: poErr } = await supa.from("purchase_orders").insert({
      name: poSeq, partner_id: supplier.id, warehouse_id: wh.id, state: "draft",
      amount_untaxed: COST, amount_tax: 0, amount_total: COST,
    }).select("id, name").single();
    if (poErr) throw poErr;
    await supa.from("purchase_order_lines").insert({
      order_id: po.id, product_id: prod.id, quantity: 1, unit_price: COST, subtotal: COST,
    });
    const { error: poConfirmErr } = await supa.rpc("confirm_purchase_order", { _order: po.id });
    if (poConfirmErr) throw poConfirmErr;
    push({ key: "po", title: "1️⃣ Encomenda de compra criada e confirmada", status: "ok",
      detail: `${po.name} · ${supplier.name} · 1x ${prod.name} @ ${COST.toFixed(2)} €`,
      link: { label: "Abrir compra", to: `/purchase/orders/${po.id}` },
      data: { po_id: po.id, po_name: po.name } });

    // ── 2. Receção da mercadoria (incoming picking) ───────────────────────────
    push = t0("receive");
    const { data: incoming } = await supa.from("stock_pickings").select("id, name, state").eq("origin", po.name).eq("kind", "incoming").maybeSingle();
    if (!incoming) throw new Error("Picking de receção não foi criado pelo confirm_purchase_order");
    // marcar quantity_done = quantity em todas as linhas
    const { data: inMoves } = await supa.from("stock_moves").select("id, quantity").eq("picking_id", incoming.id);
    for (const m of inMoves ?? []) {
      await supa.from("stock_moves").update({ quantity_done: m.quantity }).eq("id", m.id);
    }
    const { error: vInErr } = await supa.rpc("validate_picking", { _picking: incoming.id });
    if (vInErr) throw vInErr;
    push({ key: "receive", title: "2️⃣ Receção validada — stock entrou no armazém", status: "ok",
      detail: `Picking ${incoming.name} · 1x ${prod.name} → Stock`,
      link: { label: "Abrir receção", to: `/inventory/transfers/${incoming.id}` },
      data: { picking_id: incoming.id } });

    // ── 3. Venda ao cliente ───────────────────────────────────────────────────
    push = t0("sale");
    const { data: soSeq } = await supa.rpc("next_sequence", { _code: "sale_order" });
    const { data: so, error: soErr } = await supa.from("sale_orders").insert({
      name: soSeq, partner_id: customer.id, warehouse_id: wh.id, state: "draft",
      amount_untaxed: PRICE, amount_tax: 0, amount_total: PRICE,
    }).select("id, name").single();
    if (soErr) throw soErr;
    await supa.from("sale_order_lines").insert({
      order_id: so.id, product_id: prod.id, quantity: 1, unit_price: PRICE, subtotal: PRICE, line_kind: "product",
    });
    const { error: soConfirmErr } = await supa.rpc("confirm_sale_order", { _order: so.id });
    if (soConfirmErr) throw soConfirmErr;
    push({ key: "sale", title: "3️⃣ Venda criada e confirmada", status: "ok",
      detail: `${so.name} · ${customer.name} · 1x ${prod.name} @ ${PRICE.toFixed(2)} €`,
      link: { label: "Abrir venda", to: `/sales/orders/${so.id}` },
      data: { so_id: so.id, so_name: so.name } });

    // ── 4. Pagamento (consoante o modo) ───────────────────────────────────────
    push = t0("pay1");
    const firstAmount = paymentMode === "full_on_sale" ? PRICE : PRICE / 2;
    const { data: paySeq } = await supa.rpc("next_sequence", { _code: "customer_payment" });
    await supa.from("customer_payments").insert({
      name: paySeq, partner_id: customer.id, order_id: so.id,
      payment_date: new Date().toISOString().slice(0, 10),
      amount: firstAmount, method_id: method.id, journal_id: method.default_journal_id,
      state: "posted",
    });
    push({ key: "pay1", title: `4️⃣ Recebimento no caixa da venda (${paymentMode === "full_on_sale" ? "100%" : "50%"})`, status: "ok",
      detail: `${firstAmount.toFixed(2)} € · ${method.name}`,
      link: { label: "Ver venda", to: `/sales/orders/${so.id}` } });

    // ── 5. Picking de saída → primeiro vai para o Cais de Carga ───────────────
    push = t0("outgoing");
    const { data: outgoing } = await supa.from("stock_pickings").select("id, name").eq("origin", so.name).eq("kind", "outgoing").maybeSingle();
    if (!outgoing) throw new Error("Picking de saída não foi criado");
    push({ key: "outgoing", title: "5️⃣ Picking de saída gerado", status: "ok",
      detail: `${outgoing.name} (rascunho)`,
      link: { label: "Abrir saída", to: `/inventory/transfers/${outgoing.id}` },
      data: { out_id: outgoing.id } });

    // ── 6. Transferência interna Stock → Cais de Carga ────────────────────────
    push = t0("toDock");
    const { data: trDock, error: trDockErr } = await supa.rpc("create_internal_transfer", {
      _source: locStock.id,
      _destination: locCais.id,
      _lines: [{ product_id: prod.id, quantity: 1 }],
      _scheduled_at: new Date().toISOString(),
      _partner: null,
    });
    if (trDockErr) throw trDockErr;
    const trDockId = (trDock as any) as string;
    const { data: dockMoves } = await supa.from("stock_moves").select("id, quantity").eq("picking_id", trDockId);
    for (const m of dockMoves ?? []) await supa.from("stock_moves").update({ quantity_done: m.quantity }).eq("id", m.id);
    await supa.rpc("validate_picking", { _picking: trDockId });
    push({ key: "toDock", title: "6️⃣ Transferência interna: Stock → Cais de Carga", status: "ok",
      detail: `1x ${prod.name} agora no cais, à espera da carrinha`,
      link: { label: "Abrir transferência", to: `/inventory/transfers/${trDockId}` } });

    // ── 7. Carregar na carrinha (Cais → Zona Carrinha) ────────────────────────
    push = t0("toVehicle");
    const { data: trVeh, error: trVehErr } = await supa.rpc("create_internal_transfer", {
      _source: locCais.id,
      _destination: locCarr.id,
      _lines: [{ product_id: prod.id, quantity: 1 }],
      _scheduled_at: new Date().toISOString(),
      _partner: null,
    });
    if (trVehErr) throw trVehErr;
    const trVehId = (trVeh as any) as string;
    const { data: vMoves } = await supa.from("stock_moves").select("id, quantity").eq("picking_id", trVehId);
    for (const m of vMoves ?? []) await supa.from("stock_moves").update({ quantity_done: m.quantity }).eq("id", m.id);
    await supa.rpc("validate_picking", { _picking: trVehId });
    push({ key: "toVehicle", title: "7️⃣ Carregado na carrinha (Cais → Zona Carrinha)", status: "ok",
      detail: `Carrinha ${vehicle.name} (${vehicle.license_plate})`,
      link: { label: "Abrir transferência", to: `/inventory/transfers/${trVehId}` } });

    // ── 8. Lote de entrega com a carrinha ─────────────────────────────────────
    push = t0("batch");
    const { data: batchSeq } = await supa.rpc("next_sequence", { _code: "picking_batch" });
    const { data: batch, error: batchErr } = await supa.from("stock_picking_batches").insert({
      name: batchSeq, state: "in_progress", vehicle_id: vehicle.id,
      delivery_date: new Date().toISOString().slice(0, 10),
    }).select("id, name").single();
    if (batchErr) throw batchErr;
    await supa.from("stock_pickings").update({ batch_id: batch.id }).eq("id", outgoing.id);
    // marca quantity_done na saída
    const { data: outMoves } = await supa.from("stock_moves").select("id, quantity").eq("picking_id", outgoing.id);
    for (const m of outMoves ?? []) await supa.from("stock_moves").update({ quantity_done: m.quantity }).eq("id", m.id);
    push({ key: "batch", title: "8️⃣ Lote de entrega atribuído à carrinha", status: "ok",
      detail: `${batch.name} · ${vehicle.name}`,
      link: { label: "Abrir lote (motorista)", to: `/delivery/batch/${batch.id}` } });

    // ── 9. Entrega final + cobrança restante ──────────────────────────────────
    push = t0("deliver");
    const remaining = paymentMode === "full_on_sale" ? 0 : PRICE / 2;
    const { error: delErr } = await supa.rpc("driver_deliver_picking", {
      _picking: outgoing.id,
      _payment_amount: remaining,
      _method_id: remaining > 0 ? method.id : null,
    });
    if (delErr) throw delErr;
    push({ key: "deliver", title: "9️⃣ Entrega concluída pelo motorista", status: "ok",
      detail: remaining > 0 ? `Cobrou ${remaining.toFixed(2)} € na entrega · venda totalmente paga` : "Sem cobrança na entrega · venda já estava paga",
      link: { label: "Abrir picking", to: `/delivery/picking/${outgoing.id}` } });

    // ── 10. Resumo final ──────────────────────────────────────────────────────
    push = t0("summary");
    const { data: finalSO } = await supa.from("sale_orders").select("payment_status, fulfillment_status, amount_total").eq("id", so.id).maybeSingle();
    const { data: finalPick } = await supa.from("stock_pickings").select("state").eq("id", outgoing.id).maybeSingle();
    push({ key: "summary", title: "🎉 Fluxo end-to-end concluído", status: "ok",
      detail: `Venda: ${finalSO?.payment_status} / ${finalSO?.fulfillment_status} · Picking: ${finalPick?.state} · Total ${Number(finalSO?.amount_total ?? 0).toFixed(2)} €`,
      data: { so_id: so.id } });

    return new Response(JSON.stringify({ ok: true, steps }), {
      headers: { ...cors, "content-type": "application/json" },
    });
  } catch (e: any) {
    steps.push({ key: "error", title: "❌ Erro no fluxo", status: "error", detail: e?.message ?? String(e) });
    return new Response(JSON.stringify({ ok: false, steps, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...cors, "content-type": "application/json" },
    });
  }
});
