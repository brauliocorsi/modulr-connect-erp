import { supabase } from "@/integrations/supabase/client";
import { fmtMoney } from "@/lib/format";

const esc = (s: any) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export async function printSaleOrder(orderId: string) {
  // Fetch order with relations
  const { data: order } = await supabase
    .from("sale_orders")
    .select(
      "name, state, date_order, commitment_date, notes, amount_untaxed, amount_tax, amount_total, payment_status, invoice_status, invoice_number, invoice_date, partner_id, company_id, include_assembly, include_delivery, delivery_zone_label, delivery_mode"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return;

  const [{ data: partner }, { data: lines }, { data: company }, { data: payments }] = await Promise.all([
    supabase
      .from("partners")
      .select("name, tax_id, email, phone, street, city, state, zip, country")
      .eq("id", order.partner_id!)
      .maybeSingle(),
    supabase
      .from("sale_order_lines")
      .select(
        "sequence, description, quantity, unit_price, discount_pct, subtotal, line_kind, products(name, image_url), product_variants(sku, image_url, product_variant_values(product_attribute_values(name)))"
      )
      .eq("order_id", orderId)
      .order("sequence"),
    order.company_id
      ? supabase.from("companies").select("name, currency").eq("id", order.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("customer_payments")
      .select("payment_date, amount, payment_methods(name)")
      .eq("order_id", orderId)
      .eq("state", "posted")
      .order("payment_date"),
  ]);

  const paid = (payments ?? []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  const balance = Number(order.amount_total || 0) - paid;

  const productLines = (lines ?? []).filter((l: any) => (l.line_kind ?? "product") === "product");
  const serviceLines = (lines ?? []).filter((l: any) => (l.line_kind ?? "product") !== "product");

  const renderProductRow = (l: any) => {
    const variantNames = (l.product_variants?.product_variant_values || [])
      .map((x: any) => x.product_attribute_values?.name)
      .filter(Boolean)
      .join(" / ");
    const img = l.product_variants?.image_url || l.products?.image_url || "";
    const sku = l.product_variants?.sku || "";
    return `
      <tr>
        <td class="cell">
          <div class="prod">
            ${img ? `<img src="${esc(img)}" alt="" />` : `<div class="ph"></div>`}
            <div>
              <div class="pn">${esc(l.products?.name || l.description)}</div>
              ${variantNames ? `<div class="pv">${esc(variantNames)}</div>` : ""}
              ${sku ? `<div class="ps">SKU ${esc(sku)}</div>` : ""}
            </div>
          </div>
        </td>
        <td class="num">${Number(l.quantity).toLocaleString("pt-PT")}</td>
        <td class="num">${fmtMoney(Number(l.unit_price))}</td>
        <td class="num">${l.discount_pct ? `${Number(l.discount_pct)}%` : "—"}</td>
        <td class="num bold">${fmtMoney(Number(l.subtotal))}</td>
      </tr>`;
  };

  const linesHtml = productLines.map(renderProductRow).join("");

  const servicesHtml = serviceLines.length
    ? `<table class="lines" style="margin-top:16px">
        <thead><tr><th colspan="5" style="background:#eef4ff;color:#1e3a8a">Serviços</th></tr></thead>
        <tbody>
          ${serviceLines
            .map(
              (l: any) => `
            <tr>
              <td class="cell"><div class="pn">${esc(l.description)}</div>${
                l.line_kind === "delivery" && (order as any).delivery_zone_label
                  ? `<div class="pv">Zona: ${esc((order as any).delivery_zone_label)}</div>`
                  : ""
              }</td>
              <td class="num">${Number(l.quantity).toLocaleString("pt-PT")}</td>
              <td class="num">${fmtMoney(Number(l.unit_price))}</td>
              <td class="num">—</td>
              <td class="num bold">${fmtMoney(Number(l.subtotal))}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`
    : "";

  const paymentsHtml = (payments ?? []).length
    ? `<table class="pay">
        <thead><tr><th>Data</th><th>Método</th><th class="num">Valor</th></tr></thead>
        <tbody>
          ${(payments ?? [])
            .map(
              (p: any) =>
                `<tr><td>${new Date(p.payment_date).toLocaleDateString("pt-PT")}</td><td>${esc(
                  p.payment_methods?.name || ""
                )}</td><td class="num">${fmtMoney(Number(p.amount))}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>`
    : "";

  const addr = [partner?.street, partner?.zip, partner?.city, partner?.state, partner?.country]
    .filter(Boolean)
    .join(", ");

  const html = `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<title>${esc(order.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 32px; font-size: 12px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .muted { color: #666; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 2px solid #111; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; background: #eef; color: #225; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge.ok { background: #e6f7ec; color: #1a7f3c; }
  .badge.warn { background: #fff4e0; color: #8a5a00; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 20px; }
  .box { padding: 12px; background: #fafafa; border: 1px solid #eee; border-radius: 6px; }
  .box h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; color: #666; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; }
  table.lines th { text-align: left; padding: 8px; background: #f3f3f3; font-size: 11px; text-transform: uppercase; color: #444; }
  table.lines td { padding: 10px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  .num { text-align: right; }
  .bold { font-weight: 600; }
  .prod { display: flex; gap: 10px; align-items: flex-start; }
  .prod img, .prod .ph { width: 44px; height: 44px; border-radius: 4px; object-fit: cover; background: #eee; flex-shrink: 0; }
  .pn { font-weight: 600; }
  .pv { color: #555; font-size: 11px; margin-top: 2px; }
  .ps { color: #888; font-size: 10px; margin-top: 2px; font-family: ui-monospace, monospace; }
  .totals { margin-top: 16px; margin-left: auto; width: 280px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .row.total { font-size: 16px; font-weight: 700; border-top: 2px solid #111; padding-top: 8px; margin-top: 4px; }
  .totals .row.balance { color: #b00020; font-weight: 600; }
  .totals .row.paid { color: #1a7f3c; }
  .pay { margin-top: 20px; }
  .pay th, .pay td { padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 11px; }
  .notes { margin-top: 20px; padding: 10px; background: #fffbe6; border-left: 3px solid #f0c000; font-size: 11px; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #eee; color: #888; font-size: 10px; text-align: center; }
  @media print { body { margin: 16mm; } .no-print { display: none; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${esc(company?.name || "")}</h1>
      <div class="muted">Documento de venda</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:18px;font-weight:600">${esc(order.name)}</div>
      <div class="muted">Data: ${new Date(order.date_order || Date.now()).toLocaleDateString("pt-PT")}</div>
      ${order.commitment_date ? `<div class="muted">Entrega: ${new Date(order.commitment_date).toLocaleDateString("pt-PT")}</div>` : ""}
      <div style="margin-top:6px">
        <span class="badge ${order.state === "done" ? "ok" : order.state === "draft" ? "warn" : ""}">${esc(order.state)}</span>
        ${order.payment_status ? `<span class="badge ${order.payment_status === "paid" ? "ok" : "warn"}">${esc(order.payment_status)}</span>` : ""}
        ${order.invoice_number ? `<span class="badge ok">Fatura ${esc(order.invoice_number)}</span>` : ""}
      </div>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <h3>Cliente</h3>
      <div class="bold" style="font-size:14px">${esc(partner?.name || "")}</div>
      ${partner?.tax_id ? `<div class="muted">NIF: ${esc(partner.tax_id)}</div>` : ""}
      ${addr ? `<div style="margin-top:4px">${esc(addr)}</div>` : ""}
      ${partner?.email ? `<div class="muted" style="margin-top:4px">${esc(partner.email)}</div>` : ""}
      ${partner?.phone ? `<div class="muted">${esc(partner.phone)}</div>` : ""}
    </div>
    <div class="box">
      <h3>Resumo</h3>
      <div class="row" style="display:flex;justify-content:space-between"><span>Itens</span><span>${(lines ?? []).length}</span></div>
      <div class="row" style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${fmtMoney(Number(order.amount_untaxed || 0))}</span></div>
      <div class="row" style="display:flex;justify-content:space-between"><span>Imposto</span><span>${fmtMoney(Number(order.amount_tax || 0))}</span></div>
      <div class="row" style="display:flex;justify-content:space-between;font-weight:600;font-size:14px;margin-top:4px"><span>Total</span><span>${fmtMoney(Number(order.amount_total || 0))}</span></div>
    </div>
  </div>

  <table class="lines">
    <thead>
      <tr>
        <th>Produto</th>
        <th class="num" style="width:70px">Qtd</th>
        <th class="num" style="width:90px">Preço</th>
        <th class="num" style="width:60px">Desc</th>
        <th class="num" style="width:100px">Subtotal</th>
      </tr>
    </thead>
    <tbody>${linesHtml || `<tr><td colspan="5" style="text-align:center;padding:20px;color:#888">Sem linhas</td></tr>`}</tbody>
  </table>

  ${servicesHtml}

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${fmtMoney(Number(order.amount_untaxed || 0))}</span></div>
    <div class="row"><span>Imposto</span><span>${fmtMoney(Number(order.amount_tax || 0))}</span></div>
    <div class="row total"><span>Total</span><span>${fmtMoney(Number(order.amount_total || 0))}</span></div>
    ${paid > 0 ? `<div class="row paid"><span>Pago</span><span>${fmtMoney(paid)}</span></div>` : ""}
    ${balance > 0.001 ? `<div class="row balance"><span>Em aberto</span><span>${fmtMoney(balance)}</span></div>` : ""}
  </div>

  ${paymentsHtml}

  ${order.notes ? `<div class="notes"><strong>Notas:</strong> ${esc(order.notes)}</div>` : ""}

  <div class="footer">Gerado em ${new Date().toLocaleString("pt-PT")}</div>

  <script>window.onload = () => { setTimeout(() => window.print(), 300); };</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
