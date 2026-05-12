import { supabase } from "@/integrations/supabase/client";
import JsBarcode from "jsbarcode";

const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function barcodeSvg(value: string): string {
  if (!value) return "";
  try {
    const xmlSerializer = new XMLSerializer();
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    JsBarcode(svg, value, {
      format: "CODE128",
      displayValue: true,
      fontSize: 12,
      height: 40,
      margin: 2,
      width: 1.6,
    });
    return xmlSerializer.serializeToString(svg);
  } catch {
    return `<div style="font-family:monospace;font-size:11px">${esc(value)}</div>`;
  }
}

const KIND_LABEL: Record<string, string> = {
  incoming: "Recebimento",
  outgoing: "Expedição",
  internal: "Transferência interna",
};

const STATE_LABEL: Record<string, string> = {
  draft: "Rascunho",
  waiting: "Aguardando",
  ready: "Pronto",
  done: "Concluído",
  cancelled: "Cancelado",
};

export async function printPickingList(pickingId: string) {
  const { data: picking } = await supabase
    .from("stock_pickings")
    .select(
      "name, kind, state, scheduled_at, done_at, origin, partners(name, tax_id, phone, email, street, city, state, zip), source:stock_locations!stock_pickings_source_location_id_fkey(name, full_path), dest:stock_locations!stock_pickings_destination_location_id_fkey(name, full_path)"
    )
    .eq("id", pickingId)
    .maybeSingle();

  if (!picking) return;

  const { data: moves } = await supabase
    .from("stock_moves")
    .select("quantity, quantity_done, state, product_id, products(name, internal_ref, barcode), product_variants(sku, barcode, product_variant_values(product_attribute_values(name))), stock_lots(name)")
    .eq("picking_id", pickingId);

  const productIds = Array.from(new Set((moves ?? []).map((m: any) => m.product_id).filter(Boolean)));
  const { data: packages } = productIds.length
    ? await supabase
        .from("product_packages")
        .select("id, product_id, sequence, label, barcode")
        .in("product_id", productIds)
        .order("sequence", { ascending: true })
    : { data: [] as any[] };
  const packagesByProduct: Record<string, any[]> = {};
  (packages ?? []).forEach((p: any) => {
    (packagesByProduct[p.product_id] ||= []).push(p);
  });

  // Fetch live quants to know WHERE the stock currently is
  const { data: quants } = productIds.length
    ? await supabase
        .from("stock_quants")
        .select("product_id, package_id, quantity, stock_locations!inner(name, full_path, type, is_bin, barcode)")
        .in("product_id", productIds)
        .gt("quantity", 0)
    : { data: [] as any[] };
  const binsByProduct: Record<string, { label: string; qty: number; barcode: string | null }[]> = {};
  const binsByPackage: Record<string, { label: string; qty: number; barcode: string | null }[]> = {};
  (quants ?? []).forEach((q: any) => {
    const loc = q.stock_locations;
    if (!loc || loc.type !== "internal") return;
    const entry = { label: loc.full_path ?? loc.name, qty: Number(q.quantity), barcode: loc.barcode ?? null };
    if (q.package_id) (binsByPackage[q.package_id] ||= []).push(entry);
    else (binsByProduct[q.product_id] ||= []).push(entry);
  });

  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .limit(1)
    .maybeSingle();

  const partner: any = (picking as any).partners;
  const movesList = (moves ?? []) as any[];

  const rowsHtml = movesList
    .map((m: any, i: number) => {
      const variant = m.product_variants;
      const attrs = (variant?.product_variant_values ?? [])
        .map((pvv: any) => pvv?.product_attribute_values?.name)
        .filter(Boolean)
        .join(" · ");
      const sku = variant?.sku || m.products?.internal_ref || "";
      const code = variant?.barcode || m.products?.barcode || variant?.sku || m.products?.internal_ref || "";
      const pkgs = packagesByProduct[m.product_id] ?? [];
      const qty = Number(m.quantity ?? 0);
      const colisBlock = pkgs.length
        ? `<div class="colis">
            <div class="colis-title">Colis a apanhar (${pkgs.length} por unidade × ${qty} = ${pkgs.length * qty})</div>
            <table class="colis-tbl">
              <thead><tr><th>#</th><th>Etiqueta</th><th>Código de barras</th><th class="check">✓</th></tr></thead>
              <tbody>
                ${pkgs.map((p: any) => `
                  <tr>
                    <td class="num">${p.sequence}</td>
                    <td>${esc(p.label)}</td>
                    <td class="bc-cell">${p.barcode ? barcodeSvg(p.barcode) : '<span class="muted">—</span>'}</td>
                    <td class="check">${Array.from({ length: qty }).map(() => '<span class="checkbox-sm"></span>').join("")}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>`
        : "";
      return `
      <tr>
        <td class="num">${i + 1}</td>
        <td>
          <div class="prod-name">${esc(m.products?.name ?? "—")}</div>
          ${attrs ? `<div class="variant">${esc(attrs)}</div>` : ""}
          ${sku ? `<div class="muted">SKU: ${esc(sku)}</div>` : ""}
          ${m.stock_lots?.name ? `<div class="muted">Lote: ${esc(m.stock_lots.name)}</div>` : ""}
          ${colisBlock}
        </td>
        <td class="barcode">${code ? barcodeSvg(code) : '<span class="muted">—</span>'}</td>
        <td class="num">${qty}</td>
        <td class="num">${Number(m.quantity_done ?? 0)}</td>
        <td class="check"><div class="checkbox"></div></td>
      </tr>`;
    })
    .join("");

  const partnerBlock = partner
    ? `
    <div class="card">
      <div class="card-title">Parceiro</div>
      <div><strong>${esc(partner.name)}</strong></div>
      ${partner.tax_id ? `<div class="muted">NIF: ${esc(partner.tax_id)}</div>` : ""}
      ${partner.street ? `<div class="muted">${esc(partner.street)}</div>` : ""}
      ${partner.city || partner.zip ? `<div class="muted">${esc([partner.zip, partner.city, partner.state].filter(Boolean).join(" · "))}</div>` : ""}
      ${partner.phone ? `<div class="muted">Tel: ${esc(partner.phone)}</div>` : ""}
    </div>`
    : "";

  const html = `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8" />
<title>${esc(picking.name)} — Lista de Picking</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; padding: 24px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 16px 0 8px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  .doc-barcode { text-align: right; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .card { border: 1px solid #ddd; border-radius: 4px; padding: 10px 12px; }
  .card-title { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #666; margin-bottom: 4px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #ddd; padding: 8px 6px; vertical-align: top; text-align: left; }
  th { background: #f4f4f4; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
  .num { text-align: center; width: 50px; }
  .check { width: 40px; text-align: center; }
  .checkbox { width: 18px; height: 18px; border: 2px solid #111; margin: 0 auto; border-radius: 2px; }
  .barcode { width: 200px; }
  .barcode svg { width: 100%; height: 50px; }
  .prod-name { font-weight: 600; }
  .variant { font-size: 11px; font-weight: 600; color: #222; margin-top: 2px; }
  .muted { color: #666; font-size: 11px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; background: #eef; font-size: 11px; font-weight: 600; }
  .footer { margin-top: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .sig { border-top: 1px solid #111; padding-top: 6px; text-align: center; font-size: 11px; color: #444; }
  @media print {
    body { padding: 12px; }
    .no-print { display: none; }
    @page { margin: 12mm; }
  }
  .actions { margin-bottom: 16px; }
  .actions button { padding: 8px 16px; font-size: 13px; cursor: pointer; }
  .colis { margin-top: 8px; padding: 6px 8px; background: #fafafa; border: 1px dashed #bbb; border-radius: 4px; }
  .colis-title { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #555; font-weight: 700; margin-bottom: 4px; }
  .colis-tbl { width: 100%; border-collapse: collapse; }
  .colis-tbl th, .colis-tbl td { border: 1px solid #ddd; padding: 4px 6px; font-size: 11px; }
  .colis-tbl th { background: #efefef; font-size: 9px; }
  .bc-cell { width: 180px; }
  .bc-cell svg { width: 100%; height: 36px; }
  .checkbox-sm { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #111; border-radius: 2px; margin: 0 2px 0 0; vertical-align: middle; }
</style>
</head><body>
  <div class="actions no-print">
    <button onclick="window.print()">Imprimir</button>
    <button onclick="window.close()">Fechar</button>
  </div>
  <div class="header">
    <div>
      <h1>Lista de Picking</h1>
      <div class="muted">${esc(company?.name ?? "")}</div>
      <div style="margin-top:6px"><span class="badge">${esc(KIND_LABEL[picking.kind] ?? picking.kind)}</span> · ${esc(STATE_LABEL[picking.state] ?? picking.state)}</div>
    </div>
    <div class="doc-barcode">
      <div style="font-weight:600;font-size:14px">${esc(picking.name)}</div>
      ${barcodeSvg(picking.name)}
    </div>
  </div>

  <div class="meta-grid">
    <div class="card">
      <div class="card-title">Localização</div>
      <div><span class="muted">Origem:</span> ${esc(picking.source?.full_path ?? picking.source?.name ?? "—")}</div>
      <div><span class="muted">Destino:</span> ${esc(picking.dest?.full_path ?? picking.dest?.name ?? "—")}</div>
      ${picking.origin ? `<div><span class="muted">Documento origem:</span> ${esc(picking.origin)}</div>` : ""}
      ${picking.scheduled_at ? `<div><span class="muted">Programado:</span> ${new Date(picking.scheduled_at).toLocaleString("pt-PT")}</div>` : ""}
    </div>
    ${partnerBlock}
  </div>

  <h2>Movimentos (${movesList.length})</h2>
  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Produto</th>
        <th class="barcode">Código de barras</th>
        <th class="num">Pedido</th>
        <th class="num">Feito</th>
        <th class="check">✓</th>
      </tr>
    </thead>
    <tbody>${rowsHtml || `<tr><td colspan="6" style="text-align:center;color:#666;padding:16px">Sem movimentos</td></tr>`}</tbody>
  </table>

  ${""}

  <div class="footer">
    <div class="sig">Preparado por · Data</div>
    <div class="sig">Recebido por · Data</div>
  </div>

  <script>setTimeout(() => window.print(), 400);</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
