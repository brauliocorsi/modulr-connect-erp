import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callRouteRpc } from "../lib/routeRpc";
import type { ManifestRow } from "./RouteManifestTable";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  routeOrderId: string;
  saleOrderName?: string;
  packages: ManifestRow[];
  onDone: () => void;
}

type LineState = {
  selected: boolean;
  condition: "good" | "damaged" | "quarantine";
  reason: string;
};

export function ReturnPackageDialog(p: Props) {
  const [mode, setMode] = useState<"release_reserved" | "keep_reserved">("release_reserved");
  const [state, setState] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(p.packages.map((m) => [m.id, { selected: true, condition: "good", reason: "" }]))
  );
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const upd = (id: string, patch: Partial<LineState>) =>
    setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  async function submit() {
    const lines = p.packages
      .filter((m) => state[m.id]?.selected && m.stock_package_id)
      .map((m) => ({
        stock_package_id: m.stock_package_id,
        return_condition: state[m.id].condition,
        reason: state[m.id].reason || null,
      }));
    if (lines.length === 0) {
      setLastResult("Selecione pelo menos um package.");
      return;
    }
    setBusy(true);
    const res = await callRouteRpc(
      "delivery_return_to_warehouse",
      { _route_order_id: p.routeOrderId, _lines: lines, _mode: mode },
      "Retornar ao armazém"
    );
    setBusy(false);
    if (res.ok) {
      const buckets = lines
        .map((l) => `WH/RETURN/${(l.return_condition as string).toUpperCase()}`)
        .filter((v, i, a) => a.indexOf(v) === i);
      setLastResult(`Retornados: ${res.data?.returned ?? lines.length} → ${buckets.join(", ")}`);
      p.onDone();
    }
  }

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Retorno ao armazém — {p.saleOrderName ?? ""}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs">
          <span>Modo de stock:</span>
          <Select value={mode} onValueChange={(v: any) => setMode(v)}>
            <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="release_reserved">release_reserved (libertar)</SelectItem>
              <SelectItem value="keep_reserved">keep_reserved (manter reservado)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="max-h-[55vh] overflow-y-auto border rounded">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 sticky top-0">
              <tr>
                <th className="text-center px-2 py-1.5 w-10">↩</th>
                <th className="text-left px-2 py-1.5">Package</th>
                <th className="text-left px-2 py-1.5 w-40">Condição</th>
                <th className="text-left px-2 py-1.5">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {p.packages.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">Sem packages para retornar.</td></tr>
              ) : p.packages.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-2 py-1.5 text-center">
                    <Checkbox checked={state[m.id]?.selected}
                      onCheckedChange={(v) => upd(m.id, { selected: !!v })} />
                  </td>
                  <td className="px-2 py-1.5 font-mono">{m.package_ref ?? m.stock_package_id?.slice(0,8) ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    <Select value={state[m.id]?.condition}
                      onValueChange={(v: any) => upd(m.id, { condition: v })}>
                      <SelectTrigger className="h-7"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="good">good</SelectItem>
                        <SelectItem value="damaged">damaged</SelectItem>
                        <SelectItem value="quarantine">quarantine</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input className="h-7 text-xs" placeholder="motivo"
                      value={state[m.id]?.reason ?? ""}
                      onChange={(e) => upd(m.id, { reason: e.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {lastResult && (
          <div className="text-xs rounded bg-muted/40 border px-3 py-2" data-testid="return-result">
            {lastResult}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => p.onOpenChange(false)} disabled={busy}>Fechar</Button>
          <Button onClick={submit} disabled={busy} aria-label="confirmar-retorno">
            {busy ? "A retornar…" : "Confirmar retorno"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
