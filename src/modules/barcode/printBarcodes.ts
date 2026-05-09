import { supabase } from "@/integrations/supabase/client";
import JsBarcode from "jsbarcode";

const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function barcodeSvg(value: string, opts?: { height?: number; fontSize?: number; width?: number }): string {
  if (!value) return "";
  try {
    const xs = new XMLSerializer();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, value, {
      format: "CODE128",
      displayValue: true,
      fontSize: opts?.fontSize ?? 14,
      height: opts?.height ?? 60,
      margin: 4,
      width: opts?.width ?? 1.8,
    });
    return xs.serializeToString(svg);
  } catch {
    return `<div style="font-family:monospace">${esc(value)}</div>`;
  }
}

const BASE_STYLE = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color:#111; margin:0; }
  .toolbar { padding:10px 14px; background:#f4f4f4; border-bottom:1px solid #ddd; }
  .toolbar button { padding:6px 12px; font-size:13px; cursor:pointer; margin-right:6px; }
  main { padding:14px; }
  h1 { font-size:18px; margin:0 0 6px; }
  .sub { font-size:11px; color:#666; margin-bottom:14px; }
  .grid { display:grid; gap:8px; }
  .card { border:1px solid #bbb; border-radius:6px; padding:10px; text-align:center; page-break-inside:avoid; background:#fff; }
  .card .label { font-weight:700; font-size:13px; margin-bottom:4px; }
  .card .meta { font-size:10px; color:#666; margin-bottom:6px; min-height:12px; }
  .card svg { display:block; margin:0 auto; }
  .group-title { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:#444; font-weight:700; margin:14px 0 6px; border-bottom:2px solid #111; padding-bottom:2px; }
  @media print { .no-print { display:none; } }
`;

function open(html: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ============ COMMAND BARCODES ============
const COMMANDS: { group: string; items: { code: string; label: string; desc?: string }[] }[] = [
  {
    group: "Validação",
    items: [
      { code: "OK", label: "OK / Validar", desc: "Conclui a operação atual" },
      { code: "VALIDATE", label: "VALIDATE", desc: "Alias de OK" },
      { code: "VALIDAR", label: "VALIDAR", desc: "Alias em PT" },
      { code: "ESC", label: "ESC / Sair", desc: "Cancela ou volta atrás" },
      { code: "CANCEL", label: "CANCEL", desc: "Cancela operação" },
      { code: "VOLTAR", label: "VOLTAR", desc: "Sair da sessão" },
    ],
  },
  {
    group: "Operações de armazém",
    items: [
      { code: "MENU:RECECAO", label: "Receção" },
      { code: "MENU:EXPEDICAO", label: "Expedição" },
      { code: "MENU:INTERNA", label: "Transferência interna" },
      { code: "MENU:PICKING", label: "Picking (qualquer)" },
      { code: "MENU:LOTE", label: "Lote (Batch)" },
      { code: "MENU:ONDA", label: "Onda (Wave)" },
      { code: "MENU:PRODUTO", label: "Consultar produto" },
      { code: "MENU:LOCAL", label: "Consultar local" },
      { code: "MENU:HOME", label: "Início" },
    ],
  },
];

export function printCommandBarcodes() {
  const groupsHtml = COMMANDS.map(
    (g) => `
    <div class="group-title">${esc(g.group)}</div>
    <div class="grid" style="grid-template-columns:repeat(3,1fr)">
      ${g.items
        .map(
          (it) => `
        <div class="card">
          <div class="label">${esc(it.label)}</div>
          <div class="meta">${esc(it.desc ?? "")}</div>
          ${barcodeSvg(it.code, { height: 55, fontSize: 13 })}
        </div>`,
        )
        .join("")}
    </div>`,
  ).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Comandos – Barcode</title>
  <style>${BASE_STYLE}</style></head><body>
  <div class="toolbar no-print"><button onclick="window.print()">Imprimir</button><button onclick="window.close()">Fechar</button></div>
  <main>
    <h1>Comandos do leitor (Barcode App)</h1>
    <div class="sub">Recorte e cole junto ao posto. Bipe estes códigos para navegar e validar sem teclado.</div>
    ${groupsHtml}
  </main></body></html>`;
  open(html);
}

// ============ LOCATION BARCODES ============
export async function printLocationBarcodes(opts?: { warehouseId?: string }) {
  let q = supabase
    .from("stock_locations")
    .select("id,name,full_path,type,warehouse_id,barcode,warehouses(name,code)")
    .eq("active", true)
    .order("full_path", { ascending: true });
  if (opts?.warehouseId) q = q.eq("warehouse_id", opts.warehouseId);
  const { data: locs } = await q;
  const list = (locs ?? []).filter((l: any) => l.type === "internal");

  // group by warehouse
  const byWh = new Map<string, any[]>();
  list.forEach((l: any) => {
    const k = l.warehouses?.name ?? "Sem armazém";
    if (!byWh.has(k)) byWh.set(k, []);
    byWh.get(k)!.push(l);
  });

  const sections = Array.from(byWh.entries())
    .map(
      ([wh, items]) => `
    <div class="group-title">${esc(wh)} (${items.length})</div>
    <div class="grid" style="grid-template-columns:repeat(3,1fr)">
      ${items
        .map(
          (l: any) => `
        <div class="card">
          <div class="label">${esc(l.name)}</div>
          <div class="meta">${esc(l.full_path ?? "")}</div>
          ${barcodeSvg(l.full_path ?? l.name, { height: 50, fontSize: 11 })}
        </div>`,
        )
        .join("")}
    </div>`,
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Locais – Barcode</title>
  <style>${BASE_STYLE}</style></head><body>
  <div class="toolbar no-print"><button onclick="window.print()">Imprimir</button><button onclick="window.close()">Fechar</button></div>
  <main>
    <h1>Códigos de barras dos locais</h1>
    <div class="sub">${list.length} local(is) interno(s). Cole na prateleira/posição correspondente.</div>
    ${sections || '<p style="color:#999">Sem locais</p>'}
  </main></body></html>`;
  open(html);
}
