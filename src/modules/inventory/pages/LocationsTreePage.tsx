import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "react-router-dom";
import { ChevronRight, ChevronDown, Folder, Box, Plus, Printer, List as ListIcon, Network, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import PutawayDialog from "@/modules/inventory/PutawayDialog";
import { printBinLabel } from "@/modules/barcode/printBarcodes";
import JsBarcode from "jsbarcode";

type Loc = {
  id: string;
  warehouse_id: string | null;
  parent_id: string | null;
  name: string;
  full_path: string | null;
  type: string;
  is_zone: boolean;
  is_bin: boolean;
  barcode: string | null;
  active: boolean;
};

export default function LocationsTreePage() {
  const [locs, setLocs] = useState<Loc[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [genOpen, setGenOpen] = useState(false);
  const [genParent, setGenParent] = useState<Loc | null>(null);
  const [genPrefix, setGenPrefix] = useState("BIN");
  const [genFrom, setGenFrom] = useState(1);
  const [genTo, setGenTo] = useState(10);

  const load = async () => {
    const [{ data: w }, { data: l }] = await Promise.all([
      supabase.from("warehouses").select("id,name").order("name"),
      supabase.from("stock_locations").select("*").order("full_path", { nullsFirst: true }),
    ]);
    setWarehouses(w ?? []);
    setLocs((l as any) ?? []);
  };
  useEffect(() => { load(); }, []);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Loc[]>();
    for (const l of locs) {
      const k = l.parent_id;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(l);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [locs]);

  const matches = (l: Loc) => !search || l.name.toLowerCase().includes(search.toLowerCase()) || (l.barcode ?? "").toLowerCase().includes(search.toLowerCase()) || (l.full_path ?? "").toLowerCase().includes(search.toLowerCase());

  const toggle = (id: string) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const expandAll = () => setExpanded(new Set(locs.map((l) => l.id)));
  const collapseAll = () => setExpanded(new Set());

  const openGenerator = (parent: Loc) => {
    setGenParent(parent); setGenPrefix(parent.name.toUpperCase().replace(/[^A-Z0-9]/g, "")); setGenFrom(1); setGenTo(10); setGenOpen(true);
  };

  const generateBins = async () => {
    if (!genParent) return;
    const wh = genParent.warehouse_id;
    const rows = [];
    for (let i = genFrom; i <= genTo; i++) {
      const num = String(i).padStart(2, "0");
      const name = `${genPrefix}-${num}`;
      const barcode = `${genPrefix}${num}`;
      rows.push({
        warehouse_id: wh,
        parent_id: genParent.id,
        name,
        barcode,
        type: "internal",
        is_bin: true,
        is_zone: false,
        full_path: `${genParent.full_path ?? genParent.name}/${name}`,
        active: true,
      });
    }
    const { error } = await supabase.from("stock_locations").insert(rows);
    if (error) return toast.error(error.message);
    toast.success(`${rows.length} bins criados`);
    setGenOpen(false);
    setExpanded((p) => { const n = new Set(p); n.add(genParent.id); return n; });
    load();
  };

  const printLabels = async (root: Loc) => {
    const collect: Loc[] = [];
    const walk = (id: string) => {
      const ch = childrenOf.get(id) ?? [];
      for (const c of ch) { if (c.is_bin || c.barcode) collect.push(c); walk(c.id); }
    };
    if (root.is_bin) collect.push(root);
    walk(root.id);
    if (collect.length === 0) return toast.info("Sem bins/códigos para imprimir");
    if (collect.length === 1) return printBinLabel(collect[0].id);

    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const bcSvg = (val: string) => {
      try {
        const xs = new XMLSerializer();
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        JsBarcode(svg, val, { format: "CODE128", displayValue: true, fontSize: 14, height: 60, margin: 4, width: 1.8 });
        return xs.serializeToString(svg);
      } catch { return `<div style="font-family:monospace">${esc(val)}</div>`; }
    };
    const cards = collect.map((c) => {
      const code = c.barcode || c.full_path || c.name;
      return `<div class="lbl"><b>${esc(c.name)}</b><small>${esc(c.full_path ?? "")}</small>${bcSvg(code)}</div>`;
    }).join("");
    const html = `<!doctype html><html><head><title>Etiquetas Bins</title><style>
      @page{size:A4;margin:10mm}
      body{font-family:system-ui;margin:0;padding:14px}
      .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
      .lbl{border:1px solid #bbb;border-radius:6px;padding:10px;text-align:center;page-break-inside:avoid}
      .lbl b{display:block;font-size:16px;margin-bottom:2px}
      .lbl small{display:block;color:#666;font-size:11px;margin-bottom:6px}
      .toolbar{padding:8px;background:#f4f4f4;border-bottom:1px solid #ddd;margin:-14px -14px 12px}
      .toolbar button{padding:6px 12px;margin-right:6px}
      @media print{.toolbar{display:none}}
    </style></head><body>
      <div class="toolbar"><button onclick="window.print()">Imprimir</button><button onclick="window.close()">Fechar</button></div>
      <div class="grid">${cards}</div>
    </body></html>`;
    const w = window.open("", "_blank"); w?.document.write(html); w?.document.close();
  };

  const Node = ({ loc, depth }: { loc: Loc; depth: number }) => {
    const ch = childrenOf.get(loc.id) ?? [];
    const open = expanded.has(loc.id);
    const visible = matches(loc) || ch.some((c) => matches(c));
    if (!visible && search) return null;
    return (
      <div>
        <div className="flex items-center gap-1 hover:bg-muted/40 rounded px-1 py-1" style={{ paddingLeft: depth * 16 }}>
          {ch.length > 0 ? (
            <button onClick={() => toggle(loc.id)} className="p-0.5">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
          ) : <span className="w-5" />}
          {loc.is_bin ? <Box className="h-4 w-4 text-amber-600" /> : <Folder className="h-4 w-4 text-sky-600" />}
          <Link to={`/inventory/locations/${loc.id}`} className="flex-1 text-sm hover:underline">
            {loc.name}
            {loc.barcode && <span className="ml-2 font-mono text-xs text-muted-foreground">{loc.barcode}</span>}
            {!loc.active && <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>}
          </Link>
          {loc.is_bin && (
            <PutawayDialog
              locationId={loc.id}
              locationLabel={loc.full_path ?? loc.name}
              trigger={<Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Arrumar produto neste bin"><PackagePlus className="h-3 w-3 mr-1" /> Arrumar</Button>}
            />
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openGenerator(loc)} title="Gerar bins filhos">
            <Plus className="h-3 w-3 mr-1" /> Bins
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => printLabels(loc)} title="Imprimir etiquetas">
            <Printer className="h-3 w-3" />
          </Button>
        </div>
        {open && ch.map((c) => <Node key={c.id} loc={c} depth={depth + 1} />)}
      </div>
    );
  };

  // Group: warehouse → roots
  const rootsByWh = useMemo(() => {
    const map = new Map<string | null, Loc[]>();
    for (const l of locs) {
      if (l.parent_id) continue;
      const k = l.warehouse_id;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(l);
    }
    return map;
  }, [locs]);

  return (
    <>
      <PageHeader
        title="Locais (árvore)"
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Locais" }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild><Link to="/inventory/locations"><ListIcon className="h-4 w-4 mr-1" /> Lista</Link></Button>
            <Button variant="outline" size="sm" onClick={expandAll}>Expandir tudo</Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>Recolher</Button>
            <Button size="sm" asChild><Link to="/inventory/locations/new"><Plus className="h-4 w-4 mr-1" /> Novo</Link></Button>
          </div>
        }
      />
      <PageBody>
        <Card className="p-3 mb-3">
          <Input placeholder="Pesquisar por nome, código ou caminho…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Card>
        <Card className="p-3">
          {warehouses.length === 0 && <div className="text-sm text-muted-foreground">Sem armazéns.</div>}
          {warehouses.map((w) => {
            const roots = rootsByWh.get(w.id) ?? [];
            return (
              <div key={w.id} className="mb-4">
                <div className="font-semibold mb-1 flex items-center gap-2"><Network className="h-4 w-4" /> {w.name}</div>
                {roots.length === 0 ? (
                  <div className="text-xs text-muted-foreground pl-6">Sem locais ainda.</div>
                ) : roots.map((r) => <Node key={r.id} loc={r} depth={0} />)}
              </div>
            );
          })}
          {(rootsByWh.get(null)?.length ?? 0) > 0 && (
            <div>
              <div className="font-semibold mb-1">Sem armazém</div>
              {(rootsByWh.get(null) ?? []).map((r) => <Node key={r.id} loc={r} depth={0} />)}
            </div>
          )}
        </Card>
      </PageBody>

      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Gerar bins em {genParent?.name}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3">
              <Label>Prefixo</Label>
              <Input value={genPrefix} onChange={(e) => setGenPrefix(e.target.value.toUpperCase())} />
              <p className="text-xs text-muted-foreground mt-1">Ex.: <code>{genPrefix}-01</code> · barcode <code>{genPrefix}01</code></p>
            </div>
            <div>
              <Label>De</Label>
              <Input type="number" min={1} value={genFrom} onChange={(e) => setGenFrom(Number(e.target.value))} />
            </div>
            <div>
              <Label>Até</Label>
              <Input type="number" min={1} value={genTo} onChange={(e) => setGenTo(Number(e.target.value))} />
            </div>
            <div className="col-span-3 text-sm text-muted-foreground">
              Cria <strong>{Math.max(0, genTo - genFrom + 1)}</strong> bins filhos com códigos sequenciais.
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGenOpen(false)}>Cancelar</Button>
            <Button onClick={generateBins}>Gerar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
