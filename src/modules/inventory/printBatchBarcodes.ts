import { supabase } from "@/integrations/supabase/client";
import JsBarcode from "jsbarcode";

const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function barcodeSvg(value: string, opts?: { height?: number; width?: number; fontSize?: number }): string {
  if (!value) return "";
  try {
    const xmlSerializer = new XMLSerializer();
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    JsBarcode(svg, value, {
      format: "CODE128",
      displayValue: true,
      fontSize: opts?.fontSize ?? 12,
      height: opts?.height ?? 50,
      margin: 4,
      width: opts?.width ?? 1.6,
    });
    return xmlSerializer.serializeToString(svg);
  } catch {
    return `<div style="font-family:monospace;font-size:11px">${esc(value)}</div>`;
  }
}

export async function printBatchBarcodes(batchId: string) {
  const { data: batch } = await supabase
    .from("stock_picking_batches")
    .select("id,name,state,scheduled_at")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return;

  const { data: pickings } = await supabase
    .from("stock_pickings")
    .select("id,name,kind,step_label,partners(name),source_location_id,destination_location_id")
    .eq("batch_id", batchId);

  const pids = (pickings ?? []).map((p: any) => p.id);
  const { data: moves } = pids.length
    ? await supabase
        .from("stock_moves")
        .select("picking_id,quantity,products(name,internal_ref,barcode)")
        .in("picking_id", pids)
    : { data: [] as any[] };

  const movesByPicking = new Map<string, any[]>();
  (moves ?? []).forEach((m: any) => {
    if (!movesByPicking.has(m.picking_id)) movesByPicking.set(m.picking_id, []);
    movesByPicking.get(m.picking_id)!.push(m);
  });

  const productCards = (pickings ?? [])
    .map((p: any) => {
      const ms = movesByPicking.get(p.id) ?? [];
      const productHtml = ms
        .map(
          (m: any) => `
        <div class="prod">
          <div class="prod-info">
            <div class="prod-name">${esc(m.products?.name ?? "")}</div>
            <div class="prod-meta">${esc(m.products?.internal_ref ?? "")} · Qtd: ${esc(m.quantity)}</div>
          </div>
          <div class="prod-bc">${m.products?.barcode ? barcodeSvg(m.products.barcode, { height: 36, fontSize: 10, width: 1.3 }) : '<span class="no-bc">sem código</span>'}</div>
        </div>`,
        )
        .join("");
      return `
      <section class="card">
        <header>
          <div>
            <div class="picking-title">${esc(p.name)}</div>
            <div class="picking-sub">${esc(p.step_label ?? "")} ${p.partners?.name ? "· " + esc(p.partners.name) : ""}</div>
          </div>
          <div class="picking-bc">${barcodeSvg(p.name, { height: 50, fontSize: 12 })}</div>
        </header>
        <div class="products">${productHtml || '<div class="empty">Sem movimentos</div>'}</div>
      </section>`;
    })
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(batch.name)} – códigos</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color:#111; margin:0; }
    h1 { font-size:18px; margin:0 0 4px; }
    .header { display:flex; justify-content:space-between; align-items:flex-end; padding-bottom:8px; border-bottom:2px solid #111; margin-bottom:12px; }
    .card { border:1px solid #ddd; border-radius:6px; padding:10px 12px; margin-bottom:10px; page-break-inside:avoid; }
    .card header { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px; padding-bottom:6px; border-bottom:1px dashed #ccc; }
    .picking-title { font-weight:700; font-size:14px; }
    .picking-sub { font-size:11px; color:#666; }
    .picking-bc svg { display:block; }
    .products { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
    .prod { display:flex; justify-content:space-between; align-items:center; gap:8px; border:1px solid #eee; border-radius:4px; padding:6px 8px; }
    .prod-info { min-width:0; }
    .prod-name { font-size:11px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .prod-meta { font-size:10px; color:#777; }
    .prod-bc svg { display:block; }
    .no-bc { font-size:10px; color:#aaa; font-style:italic; }
    .empty { font-size:11px; color:#999; padding:8px; text-align:center; }
    @media print { .no-print { display:none; } }
    .toolbar { padding:10px 14px; background:#f4f4f4; border-bottom:1px solid #ddd; }
    .toolbar button { padding:6px 12px; font-size:13px; cursor:pointer; }
  </style></head>
  <body>
    <div class="toolbar no-print"><button onclick="window.print()">Imprimir</button></div>
    <main style="padding:14px">
      <div class="header">
        <div>
          <h1>Códigos de barras – ${esc(batch.name)}</h1>
          <div style="font-size:11px;color:#666">${(pickings ?? []).length} transferência(s)</div>
        </div>
        <div>${barcodeSvg(batch.name, { height: 60, fontSize: 14, width: 2 })}</div>
      </div>
      ${productCards || '<p style="color:#999">Lote vazio</p>'}
    </main>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
