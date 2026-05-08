import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { Lock, Plus, ArrowDownToLine } from "lucide-react";
import { CashMovementDialog } from "@/modules/cashbox/components/CashMovementDialog";

const KIND_LABEL: Record<string, string> = {
  opening: "Abertura", sale: "Venda", withdrawal: "Retirada", expense: "Despesa",
  bonus: "Bónus", advance: "Adiantamento", sangria: "Sangria", deposit: "Reforço", cancel: "Estorno",
};

export default function CashSessionDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sess, setSess] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [movDlg, setMovDlg] = useState(false);
  const [closeDlg, setCloseDlg] = useState(false);
  const [counted, setCounted] = useState<string>("");

  const load = async () => {
    const { data: s } = await supabase
      .from("cash_sessions")
      .select("*, cash_registers(name, warehouses(name))")
      .eq("id", id!).maybeSingle();
    setSess(s);
    const { data: m } = await supabase
      .from("cash_movements")
      .select("*")
      .eq("session_id", id!)
      .order("created_at", { ascending: false });
    setMoves(m ?? []);
  };
  useEffect(() => { if (id) load(); }, [id]);

  const balance = moves.reduce((s, m) => s + Number(m.amount || 0), 0);
  const totalIn = moves.filter((m) => Number(m.amount) > 0 && m.kind !== "opening").reduce((s, m) => s + Number(m.amount), 0);
  const totalOut = moves.filter((m) => Number(m.amount) < 0).reduce((s, m) => s + Number(m.amount), 0);

  const close = async () => {
    if (counted === "") return toast.error("Informe o valor contado");
    const { error } = await supabase.rpc("close_cash_session", { _session: id!, _counted: Number(counted) });
    if (error) return toast.error(error.message);
    toast.success("Sessão fechada");
    setCloseDlg(false);
    load();
  };

  if (!sess) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  const isOpen = sess.state === "open";

  return (
    <>
      <FormHeader
        title={sess.name}
        breadcrumb={[
          { label: "Caixa" },
          { label: "Caixas", to: "/cashbox" },
          { label: sess.cash_registers?.name ?? "Caixa", to: `/cashbox/${sess.register_id}` },
          { label: sess.name },
        ]}
        backTo={`/cashbox/${sess.register_id}`}
        state={{ label: isOpen ? "aberta" : "fechada", tone: isOpen ? "success" : "default" }}
        actions={
          isOpen ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setMovDlg(true)}><Plus className="h-4 w-4 mr-1" /> Movimento</Button>
              <Button size="sm" onClick={() => { setCounted(String(balance.toFixed(2))); setCloseDlg(true); }}><Lock className="h-4 w-4 mr-1" /> Fechar</Button>
            </div>
          ) : null
        }
      />
      <PageBody>
        <Card className="p-4 grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
          <Stat label="Abertura" value={fmtMoney(sess.opening_balance)} />
          <Stat label="Entradas" value={fmtMoney(totalIn)} tone="emerald" />
          <Stat label="Saídas" value={fmtMoney(totalOut)} tone="rose" />
          <Stat label="Saldo atual" value={fmtMoney(balance)} />
          {!isOpen && <Stat label="Diferença" value={fmtMoney(sess.difference ?? 0)} tone={Number(sess.difference) === 0 ? "muted" : "rose"} />}
        </Card>

        <Card>
          <div className="px-4 py-3 border-b font-semibold">Movimentos</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2">Data</th>
                  <th className="text-left px-3 py-2">Tipo</th>
                  <th className="text-left px-3 py-2">Referência</th>
                  <th className="text-left px-3 py-2">Notas</th>
                  <th className="text-right px-3 py-2">Valor</th>
                </tr>
              </thead>
              <tbody>
                {moves.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Sem movimentos</td></tr>
                ) : moves.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(m.created_at).toLocaleString("pt-PT")}</td>
                    <td className="px-3 py-2">{KIND_LABEL[m.kind] ?? m.kind}</td>
                    <td className="px-3 py-2 font-mono">{m.reference ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{m.notes ?? ""}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${Number(m.amount) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {fmtMoney(m.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>

      <CashMovementDialog open={movDlg} onOpenChange={setMovDlg} sessionId={id!} onSaved={load} />

      <Dialog open={closeDlg} onOpenChange={setCloseDlg}>
        <DialogContent>
          <DialogHeader><DialogTitle>Fechar sessão</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="text-sm text-muted-foreground">Saldo teórico: <strong>{fmtMoney(balance)}</strong></div>
            <div>
              <Label>Valor contado em caixa</Label>
              <Input type="number" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCloseDlg(false)}>Cancelar</Button>
            <Button onClick={close}><ArrowDownToLine className="h-4 w-4 mr-1" /> Fechar caixa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "rose" | "muted" }) {
  const cls = tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
