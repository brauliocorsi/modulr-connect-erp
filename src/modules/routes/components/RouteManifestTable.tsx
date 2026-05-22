import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

export interface ManifestRow {
  id: string;
  stock_package_id: string | null;
  package_ref: string | null;
  package_sequence: number | null;
  package_total: number | null;
  product_id: string | null;
  product_name?: string | null;
  customer_name?: string | null;
  sale_order_name?: string | null;
  route_order_sequence?: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  fragile: boolean;
  stackable: boolean;
  requires_flat_transport: boolean;
  qty_loaded: number;
  qty_delivered: number;
  qty_returned: number;
  qty_pending: number | null;
  assistance_required: boolean;
  damaged: boolean;
  package_status?: string | null;
  package_location?: string | null;
}

function dim(v: any) {
  if (v === null || v === undefined || v === "") return "—";
  return Number(v).toFixed(1);
}

export function RouteManifestTable({ rows }: { rows: ManifestRow[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((m) =>
      [m.product_name, m.package_ref, m.customer_name, m.sale_order_name]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(t))
    );
  }, [rows, q]);

  return (
    <Card>
      <div className="px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-sm">Manifesto da viatura</div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrar por produto, package, cliente…"
              className="h-8 w-72 pl-7 text-xs"
            />
          </div>
          <div className="text-xs text-muted-foreground">{filtered.length}/{rows.length} linha(s)</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-2 py-1.5">#</th>
              <th className="text-left px-2 py-1.5">Package</th>
              <th className="text-left px-2 py-1.5">Produto</th>
              <th className="text-left px-2 py-1.5">Cliente / SO</th>
              <th className="text-right px-2 py-1.5">C×L×A (cm)</th>
              <th className="text-right px-2 py-1.5">Peso</th>
              <th className="text-left px-2 py-1.5">Flags</th>
              <th className="text-right px-2 py-1.5">Carr.</th>
              <th className="text-right px-2 py-1.5">Entr.</th>
              <th className="text-right px-2 py-1.5">Ret.</th>
              <th className="text-left px-2 py-1.5">Estado físico</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">
                  Sem packages no manifesto ainda. Use "Carregar viatura" depois de mover o stock para o cais.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id} className="border-t hover:bg-accent/30">
                  <td className="px-2 py-1.5 tabular-nums">{m.route_order_sequence ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    <div className="font-mono">{m.package_ref ?? m.stock_package_id?.slice(0, 8) ?? "—"}</div>
                    {m.package_sequence && m.package_total && (
                      <div className="text-[10px] text-muted-foreground">
                        {m.package_sequence}/{m.package_total}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">{m.product_name ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    <div>{m.customer_name ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">{m.sale_order_name ?? ""}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {dim(m.length_cm)}×{dim(m.width_cm)}×{dim(m.height_cm)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{dim(m.weight_kg)} kg</td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {m.fragile && <Badge variant="outline" className="text-[9px] border-amber-400 text-amber-700">frágil</Badge>}
                      {!m.stackable && <Badge variant="outline" className="text-[9px] border-blue-400 text-blue-700">n/empil</Badge>}
                      {m.requires_flat_transport && <Badge variant="outline" className="text-[9px] border-purple-400 text-purple-700">plano</Badge>}
                      {m.assistance_required && <Badge variant="outline" className="text-[9px] border-orange-400 text-orange-700">assist</Badge>}
                      {m.damaged && <Badge variant="destructive" className="text-[9px]">danif</Badge>}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m.qty_loaded}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m.qty_delivered}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m.qty_returned}</td>
                  <td className="px-2 py-1.5">
                    <Badge variant="outline" className="text-[10px] capitalize">{m.package_status ?? "—"}</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
