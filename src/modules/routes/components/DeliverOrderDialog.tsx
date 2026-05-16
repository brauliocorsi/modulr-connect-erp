import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callRouteRpc } from "../lib/routeRpc";
import type { ManifestRow } from "./RouteManifestTable";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  routeOrderId: string;
  customer?: string;
  saleOrderName?: string;
  packages: ManifestRow[];
  onDone: () => void;
}

type LineState = {
  deliver: boolean;
  return: boolean;
  damaged: boolean;
  quarantine: boolean;
  assistance: boolean;
  reason: string;
};

const empty: LineState = {
  deliver: true,
  return: false,
  damaged: false,
  quarantine: false,
  assistance: false,
  reason: "",
};

export function DeliverOrderDialog(p: Props) {
  const [state, setState] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(p.packages.map((m) => [m.id, { ...empty }]))
  );
  const [busy, setBusy] = useState(false);

  const upd = (id: string, patch: Partial<LineState>) =>
    setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  async function submit() {
    const lines: any[] = [];
    for (const m of p.packages) {
      const ls = state[m.id];
      if (!ls.deliver && !ls.return) continue;
      if (!m.stock_package_id) continue;
      if (ls.deliver) {
        lines.push({
          stock_package_id: m.stock_package_id,
          qty_delivered: m.qty_loaded - m.qty_delivered,
          assistance_required: ls.assistance,
        });
      }
    }
    if (lines.length === 0) {
      // Allow "deliver order" with no per-package detail — backend will mark order delivered if all packages already done.
    }
    setBusy(true);
    const res = await callRouteRpc(
      "delivery_order_deliver",
      { _route_order_id: p.routeOrderId, _lines: lines },
      "Entregar pedido"
    );
    setBusy(false);
    if (res.ok) {
      p.onDone();
      p.onOpenChange(false);
    }
  }

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Entregar pedido — {p.saleOrderName ?? ""}
            <div className="text-xs font-normal text-muted-foreground">{p.customer ?? ""}</div>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto border rounded">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5">Package</th>
                <th className="text-center px-2 py-1.5">Entregar</th>
                <th className="text-center px-2 py-1.5">Assist.</th>
                <th className="text-right px-2 py-1.5">Qty carr.</th>
                <th className="text-right px-2 py-1.5">Qty entr.</th>
              </tr>
            </thead>
            <tbody>
              {p.packages.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Sem packages neste pedido (entrega sem rastreio).</td></tr>
              ) : p.packages.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-2 py-1.5 font-mono">{m.package_ref ?? m.stock_package_id?.slice(0,8) ?? "—"}</td>
                  <td className="px-2 py-1.5 text-center">
                    <Checkbox checked={state[m.id]?.deliver}
                      onCheckedChange={(v) => upd(m.id, { deliver: !!v })} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Checkbox checked={state[m.id]?.assistance}
                      onCheckedChange={(v) => upd(m.id, { assistance: !!v })} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m.qty_loaded}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m.qty_delivered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-[11px] text-muted-foreground">
          Para retornos (damaged/quarantine), feche este diálogo e use "Retornar ao armazém".
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => p.onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy} aria-label="confirmar-entrega">
            {busy ? "A entregar…" : "Confirmar entrega"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
