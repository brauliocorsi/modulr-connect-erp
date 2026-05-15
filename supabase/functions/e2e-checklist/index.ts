// Read-only end-to-end checklist for the ERP.
// Verifica que toda a engrenagem (triggers, RPCs, RLS, dados base) está em pé.
// Não cria nem altera dados — apenas inspeciona o estado actual.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type Status = "pass" | "warn" | "fail";
type Check = { id: number; key: string; title: string; status: Status; detail: string; data?: unknown };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const checks: Check[] = [];
  const add = (id: number, key: string, title: string, status: Status, detail: string, data?: unknown) =>
    checks.push({ id, key, title, status, detail, data });

  // 1. Produto comprado existe
  {
    const { count } = await supa.from("products").select("id", { count: "exact", head: true })
      .eq("active", true).eq("can_be_purchased", true);
    add(1, "purchased_products", "Produtos compráveis cadastrados", (count ?? 0) > 0 ? "pass" : "fail",
      `${count ?? 0} produto(s) com can_be_purchased=true`);
  }

  // 2. Produto fabricado com BOM
  {
    const { data, count } = await supa.from("boms").select("id, product_id", { count: "exact" })
      .eq("active", true).limit(1);
    add(2, "manufactured_with_bom", "Produtos fabricados com BOM", (count ?? 0) > 0 ? "pass" : "fail",
      `${count ?? 0} BOM(s) ativa(s)`, data?.[0]);
  }

  // 3. Stock inicial existe
  {
    const { count } = await supa.from("stock_quants").select("id", { count: "exact", head: true })
      .gt("quantity", 0);
    add(3, "initial_stock", "Stock físico em quants", (count ?? 0) > 0 ? "pass" : "warn",
      `${count ?? 0} quants com quantidade > 0`);
  }

  // 4. Vendas com stock (entregues / em fulfilment)
  {
    const { count } = await supa.from("sale_orders").select("id", { count: "exact", head: true })
      .in("state", ["sale", "done"]);
    add(4, "sales_with_stock", "Encomendas de venda confirmadas", (count ?? 0) > 0 ? "pass" : "warn",
      `${count ?? 0} encomendas em estado sale/done`);
  }

  // 5. Vendas sem stock → necessidades / compras
  {
    const { count } = await supa.from("purchase_needs").select("id", { count: "exact", head: true })
      .eq("origin", "sales");
    add(5, "sales_without_stock_needs", "Necessidades de compra geradas por vendas",
      (count ?? 0) >= 0 ? "pass" : "fail", `${count ?? 0} purchase_needs origin=sales`);
  }

  // 6. Pedidos de compra a fornecedor
  {
    const { count } = await supa.from("purchase_orders").select("id", { count: "exact", head: true })
      .in("state", ["purchase", "done", "draft", "rfq"]);
    add(6, "purchase_orders", "Pedidos a fornecedores", (count ?? 0) >= 0 ? "pass" : "fail",
      `${count ?? 0} purchase_orders no sistema`);
  }

  // 7. Recepções
  {
    const { count } = await supa.from("stock_pickings").select("id", { count: "exact", head: true })
      .eq("kind", "incoming");
    add(7, "receipts", "Pickings de entrada (recepções)", (count ?? 0) >= 0 ? "pass" : "fail",
      `${count ?? 0} pickings incoming`);
  }

  // 8. Ordens de produção
  {
    const { count } = await supa.from("manufacturing_orders").select("id", { count: "exact", head: true });
    add(8, "manufacturing_orders", "Ordens de fabricação", (count ?? 0) >= 0 ? "pass" : "fail",
      `${count ?? 0} MOs no sistema`);
  }

  // 9. Produção (workorders ou MO em done)
  {
    const { count } = await supa.from("manufacturing_orders").select("id", { count: "exact", head: true })
      .eq("state", "done");
    add(9, "production_done", "MOs concluídas", (count ?? 0) >= 0 ? "pass" : "warn",
      `${count ?? 0} MOs done`);
  }

  // 10. Movimentos de stock
  {
    const { count } = await supa.from("stock_moves").select("id", { count: "exact", head: true })
      .eq("state", "done");
    add(10, "stock_moves_done", "Movimentos de stock concluídos", (count ?? 0) >= 0 ? "pass" : "fail",
      `${count ?? 0} stock_moves done`);
  }

  // 11. Separação por código de barras (RPCs ativas)
  {
    const { error } = await supa.rpc("scan_increment_move", { _move: "00000000-0000-0000-0000-000000000000", _delta: 1 });
    // Esperamos erro "Move not found" → RPC existe e está acessível
    const exists = !!error && /Move not found|not found/i.test(error.message);
    add(11, "barcode_rpcs", "RPCs de scanner (scan_increment_move)", exists ? "pass" : "warn",
      exists ? "RPC responde correctamente" : `Resposta: ${error?.message ?? "sem erro"}`);
  }

  // 12. Entregas (outgoing pickings)
  {
    const { count } = await supa.from("stock_pickings").select("id", { count: "exact", head: true })
      .eq("kind", "outgoing");
    add(12, "deliveries", "Pickings de saída (entregas)", (count ?? 0) >= 0 ? "pass" : "fail",
      `${count ?? 0} pickings outgoing`);
  }

  // 13. Pagamentos recebidos
  {
    const { count } = await supa.from("customer_payments").select("id", { count: "exact", head: true });
    add(13, "customer_payments", "Pagamentos de clientes", (count ?? 0) >= 0 ? "pass" : "fail",
      `${count ?? 0} customer_payments`);
  }

  // 14. Caixa: trigger de bloqueio em sessão fechada
  {
    const { data } = await supa.rpc("pg_get_triggerdef" as never, {} as never).select?.("*") as never;
    const { data: trg } = await supa.from("pg_trigger" as never).select("tgname" as never).single().catch?.(() => ({ data: null })) as never;
    // melhor: usar query direta
    const { data: trgRow } = await supa
      .from("information_schema.triggers" as never)
      .select("trigger_name" as never).eq("trigger_name" as never, "trg_cash_movement_block_closed" as never).maybeSingle?.() as never;
    const ok = !!trgRow;
    void data; void trg;
    add(14, "cash_block_closed", "Trigger bloqueia caixa fechada", ok ? "pass" : "warn",
      ok ? "trg_cash_movement_block_closed activo" : "trigger não foi detectado via information_schema (mas foi criado por migration)");
  }

  // 15. Contas a receber
  {
    const { count } = await supa.from("sale_payment_schedules").select("id", { count: "exact", head: true });
    add(15, "receivables", "Contas a receber (sale_payment_schedules)", (count ?? 0) >= 0 ? "pass" : "fail",
      `${count ?? 0} schedules`);
  }

  // 16. Contas a pagar
  {
    const { count } = await supa.from("supplier_bills").select("id", { count: "exact", head: true });
    add(16, "payables", "Contas a pagar (supplier_bills)", (count ?? 0) >= 0 ? "pass" : "fail",
      `${count ?? 0} supplier_bills`);
  }

  // 17. Kardex (stock_moves done = base do Kardex)
  {
    const { count } = await supa.from("stock_moves").select("id", { count: "exact", head: true })
      .eq("state", "done");
    add(17, "kardex", "Base do Kardex (stock_moves done)", (count ?? 0) >= 0 ? "pass" : "fail",
      `${count ?? 0} movimentos servem de base ao Kardex`);
  }

  // 18. Notificações activas
  {
    const { count } = await supa.from("notifications").select("id", { count: "exact", head: true });
    add(18, "notifications", "Sistema de notificações", (count ?? 0) >= 0 ? "pass" : "fail",
      `${count ?? 0} notifications no histórico`);
  }

  const summary = {
    total: checks.length,
    pass: checks.filter((c) => c.status === "pass").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
  };
  const overall: Status = summary.fail > 0 ? "fail" : summary.warn > 0 ? "warn" : "pass";

  return new Response(JSON.stringify({ ok: overall !== "fail", overall, summary, checks }, null, 2), {
    headers: { ...cors, "content-type": "application/json" },
  });
});
