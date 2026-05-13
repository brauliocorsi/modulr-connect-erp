import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/format";

export default function DriverHandoversPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [notes, setNotes] = useState("");

  const load = async () => {
    const { data } = await supabase
      .from("cash_sessions")
      .select("*, cash_registers(name, driver_id), delivery_routes(route_date, delivery_zones(name))")
      .eq("handover_state", "pending_handover")
      .order("handover_at", { ascending: false });
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const openDetail = async (s: any) => {
    setSel(s); setNotes("");
    const { data } = await supabase.from("cash_movements")
      .select("*, customer_payments(payment_methods(name)), stock_pickings(name, partners(name))")
      .eq("session_id", s.id).order("created_at");
    setMoves(data ?? []);
  };

  const reconcile = async () => {
    const { error } = await supabase.rpc("finance_reconcile_session", { _session: sel.id, _notes: notes || null });
    if (error) return toast.error(error.message);
    toast.success("Caixa conciliado"); setSel(null); load();
  };

  const totals = (() => {
    const map = new Map<string, number>();
    for (const m of moves) {
      if (m.kind === "opening") continue;
      const n = m.customer_payments?.payment_methods?.name ?? "Dinheiro";
      map.set(n, (map.get(n) ?? 0) + Number(m.amount || 0));
    }
    return Array.from(map.entries());
  })();

  return (
    <>
      <PageHeader title="Entregas e caixa" subtitle="Conferência de caixas entregues por motoristas"
        breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Entregas e caixa" }]} />
      <PageBody>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2">Caixa</th>
                  <th className="text-left px-3 py-2">Sessão</th>
                  <th className="text-left px-3 py-2">Rota</th>
                  <th className="text-left px-3 py-2">Entregue em</th>
                  <th className="text-right px-3 py-2">Dinheiro contado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Sem caixas pendentes.</td></tr>}
                {rows.map((s: any) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-2">{s.cash_registers?.name}</td>
                    <td className="px-3 py-2">{s.name}</td>
                    <td className="px-3 py-2">{s.delivery_routes ? `${s.delivery_routes.delivery_zones?.name} · ${s.delivery_routes.route_date}` : "—"}</td>
                    <td className="px-3 py-2">{s.handover_at ? new Date(s.handover_at).toLocaleString("pt-PT") : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.handover_cash_amount ?? 0)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" onClick={() => openDetail(s)}>Conferir</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>

      <Dialog open={!!sel} onOpenChange={(v) => !v && setSel(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Conferir caixa {sel?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Abertura" value={fmtMoney(sel?.opening_balance ?? 0)} />
              <Stat label="Dinheiro contado" value={fmtMoney(sel?.handover_cash_amount ?? 0)} />
              <Stat label="Diferença" value={fmtMoney(sel?.difference ?? 0)} />
            </div>
            <div>
              <div className="text-xs font-semibold text-muted-foreground mb-1">Totais por método</div>
              <div className="flex flex-wrap gap-2">
                {totals.map(([n, v]) => (
                  <div key={n} className="rounded border px-2 py-1 text-sm">
                    {n}: <span className="font-mono">{fmtMoney(v)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="max-h-64 overflow-auto border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr><th className="text-left px-2 py-1">Entrega</th><th className="text-left px-2 py-1">Cliente</th>
                  <th className="text-left px-2 py-1">Método</th><th className="text-right px-2 py-1">Valor</th></tr>
                </thead>
                <tbody>
                  {moves.filter((m) => m.kind !== "opening").map((m: any) => (
                    <tr key={m.id} className="border-t">
                      <td className="px-2 py-1">{m.stock_pickings?.name ?? "—"}</td>
                      <td className="px-2 py-1">{m.stock_pickings?.partners?.name ?? "—"}</td>
                      <td className="px-2 py-1">{m.customer_payments?.payment_methods?.name ?? "Dinheiro"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <Textarea placeholder="Notas da conferência (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSel(null)}>Fechar</Button>
            <Button onClick={reconcile}><ShieldCheck className="h-4 w-4 mr-1" /> Conciliar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
