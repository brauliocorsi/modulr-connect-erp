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
import { Lock, Plus, ArrowDownToLine, Undo2 } from "lucide-react";
import { CashMovementDialog } from "@/modules/cashbox/components/CashMovementDialog";
import { CashSessionAuditLog } from "@/modules/cashbox/components/CashSessionAuditLog";
import { ConfirmActionDialog } from "@/core/operational";

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
  const [methodFilter, setMethodFilter] = useState<string>("all");

  const [openerName, setOpenerName] = useState<string>("");

  const [reconcile, setReconcile] = useState<any[]>([]);
  const [reverseTarget, setReverseTarget] = useState<{ id: string; reason: string } | null>(null);
  const [reversing, setReversing] = useState(false);

  const load = async () => {
    const { data: s } = await supabase
      .from("cash_sessions")
      .select("*, cash_registers(name, warehouses(name))")
      .eq("id", id!).maybeSingle();
    setSess(s);
    if (s?.opened_by) {
      const { data: prof } = await supabase
        .from("profiles").select("full_name, email").eq("id", s.opened_by).maybeSingle();
      setOpenerName(prof?.full_name || prof?.email || "");
    } else setOpenerName("");
    const { data: m } = await supabase
      .from("cash_movements")
      .select("*, customer_payments(method_id, order_id, payment_methods(name), sale_orders(id,name))")
      .eq("session_id", id!)
      .order("created_at", { ascending: false });
    setMoves(m ?? []);
    if (s?.opened_at && s?.opened_by) {
      const fromIso = s.opened_at;
      const toIso = s.closed_at ?? new Date().toISOString();
      const { data: pays } = await supabase
        .from("customer_payments")
        .select("id, amount, created_at, reference, name, payment_methods!inner(name, feeds_cash_session)")
        .eq("state", "posted")
        .eq("created_by", s.opened_by)
        .gte("created_at", fromIso)
        .lte("created_at", toIso);
      setReconcile((pays ?? []).filter((p: any) => p.payment_methods?.feeds_cash_session === false));
    } else setReconcile([]);
  };

  const methodTotals = (() => {
    const map = new Map<string, number>();
    for (const m of moves) {
      const name = m.customer_payments?.payment_methods?.name
        ?? (m.kind === "opening" ? "Abertura" : KIND_LABEL[m.kind] ?? m.kind);
      map.set(name, (map.get(name) ?? 0) + Number(m.amount || 0));
    }
    return Array.from(map.entries()).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  })();
  useEffect(() => { if (id) load(); }, [id]);

  const isCashMove = (m: any) => {
    const name = m.customer_payments?.payment_methods?.name?.toLowerCase() ?? "";
    if (!m.payment_id) return true; // abertura, sangria, retirada, despesa, depósito → dinheiro físico
    return ["dinheiro", "cash", "numerário", "numerario"].some((c) => name.includes(c));
  };
  const cashMoves = moves.filter(isCashMove);
  const nonCashMoves = moves.filter((m) => !isCashMove(m));

  const balance = cashMoves.reduce((s, m) => s + Number(m.amount || 0), 0);
  const totalIn = cashMoves.filter((m) => Number(m.amount) > 0 && m.kind !== "opening").reduce((s, m) => s + Number(m.amount), 0);
  const totalOut = cashMoves.filter((m) => Number(m.amount) < 0).reduce((s, m) => s + Number(m.amount), 0);
  const reconcileTotal = nonCashMoves.reduce((s, m) => s + Number(m.amount || 0), 0);

  const methodNames = Array.from(new Set(moves.map((m) =>
    m.customer_payments?.payment_methods?.name ?? (m.kind === "opening" ? "Abertura" : KIND_LABEL[m.kind] ?? m.kind)
  )));
  const filteredMoves = methodFilter === "all" ? moves : moves.filter((m) => {
    const name = m.customer_payments?.payment_methods?.name ?? (m.kind === "opening" ? "Abertura" : KIND_LABEL[m.kind] ?? m.kind);
    return name === methodFilter;
  });

  const close = async () => {
    if (counted === "") return toast.error("Informe o valor contado");
    const { error } = await supabase.rpc("close_cash_session", { _session: id!, _counted: Number(counted) });
    if (error) return toast.error(error.message);
    toast.success("Sessão fechada");
    setCloseDlg(false);
    load();
  };

  const reversedIds = new Set(moves.filter((m) => m.reversal_of_id).map((m) => m.reversal_of_id));
  const reverseMove = async () => {
    if (!reverseTarget) return;
    if (!reverseTarget.reason.trim()) return toast.error("Motivo obrigatório");
    setReversing(true);
    const { error } = await supabase.rpc("cash_movement_reverse", {
      _movement_id: reverseTarget.id,
      _reason: reverseTarget.reason.trim(),
    });
    setReversing(false);
    if (error) return toast.error(error.message);
    toast.success("Movimento revertido");
    setReverseTarget(null);
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
        <Card className="p-4 grid grid-cols-2 sm:grid-cols-7 gap-4 mb-4">
          <Stat label="Aberta por" value={openerName || "—"} />
          <Stat label="Aberta em" value={sess.opened_at ? new Date(sess.opened_at).toLocaleString("pt-PT") : "—"} />
          <Stat label="Abertura" value={fmtMoney(sess.opening_balance)} />
          <Stat label="Entradas em dinheiro" value={fmtMoney(totalIn)} tone="emerald" />
          <Stat label="Saídas" value={fmtMoney(totalOut)} tone="rose" />
          <Stat label="Dinheiro em caixa" value={fmtMoney(balance)} />
          <Stat label="Para conciliação" value={fmtMoney(reconcileTotal)} tone="muted" />
          {!isOpen && <Stat label="Diferença" value={fmtMoney(sess.difference ?? 0)} tone={Number(sess.difference) === 0 ? "muted" : "rose"} />}
        </Card>

        {nonCashMoves.length > 0 && (
          <Card className="p-4 mb-4">
            <div className="text-sm font-semibold mb-3">A enviar para conciliação financeira (cartão / multibanco / transferência)</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(nonCashMoves.reduce((acc: Record<string, number>, m: any) => {
                const name = m.customer_payments?.payment_methods?.name ?? "—";
                acc[name] = (acc[name] ?? 0) + Number(m.amount || 0);
                return acc;
              }, {})).map(([name, total]) => (
                <div key={name} className="rounded-md border bg-muted/30 px-3 py-2 min-w-[140px]">
                  <div className="text-xs text-muted-foreground">{name}</div>
                  <div className="text-base font-semibold tabular-nums">{fmtMoney(total as number)}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-4 mb-4">
          <div className="text-sm font-semibold mb-3">Por forma de pagamento</div>
          {methodTotals.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sem movimentos</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {methodTotals.map(([name, total]) => (
                <div key={name} className="rounded-md border bg-muted/30 px-3 py-2 min-w-[140px]">
                  <div className="text-xs text-muted-foreground">{name}</div>
                  <div className={`text-base font-semibold tabular-nums ${total < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {fmtMoney(total)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="px-4 py-3 border-b font-semibold flex items-center justify-between gap-3">
            <span>Movimentos</span>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="all">Todas as formas</option>
              {methodNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2">Data</th>
                  <th className="text-left px-3 py-2">Tipo</th>
                  <th className="text-left px-3 py-2">Forma</th>
                  <th className="text-left px-3 py-2">Venda</th>
                  <th className="text-left px-3 py-2">Referência</th>
                  <th className="text-left px-3 py-2">Notas</th>
                  <th className="text-right px-3 py-2">Valor</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filteredMoves.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sem movimentos</td></tr>
                ) : filteredMoves.map((m) => {
                  const isReversal = !!m.reversal_of_id;
                  const wasReversed = reversedIds.has(m.id);
                  const canReverse = isOpen && !isReversal && !wasReversed && m.kind !== "opening";
                  const sale = m.customer_payments?.sale_orders;
                  const methodLabel = m.kind === "opening"
                    ? "Dinheiro"
                    : (m.customer_payments?.payment_methods?.name ?? (m.payment_id ? "—" : "Dinheiro"));
                  return (
                    <tr key={m.id} className={`border-t ${isReversal || wasReversed ? "opacity-60" : ""}`}>
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(m.created_at).toLocaleString("pt-PT")}</td>
                      <td className="px-3 py-2">
                        {KIND_LABEL[m.kind] ?? m.kind}
                        {isReversal && <span className="ml-2 text-xs text-muted-foreground">(reversão)</span>}
                        {wasReversed && <span className="ml-2 text-xs text-muted-foreground">(revertido)</span>}
                      </td>
                      <td className="px-3 py-2">{methodLabel}</td>
                      <td className="px-3 py-2">
                        {sale?.id ? (
                          <a
                            href={`/sales/orders/${sale.id}`}
                            className="font-mono text-xs text-primary hover:underline"
                            onClick={(e) => { e.preventDefault(); nav(`/sales/orders/${sale.id}`); }}
                          >
                            {sale.name}
                          </a>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 font-mono">{m.reference ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{m.notes ?? m.reversal_reason ?? ""}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${Number(m.amount) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {fmtMoney(m.amount)}
                      </td>
                      <td className="px-2">
                        {canReverse && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Reverter movimento"
                            onClick={() => setReverseTarget({ id: m.id, reason: "" })}
                          >
                            <Undo2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="mt-4">
          <CashSessionAuditLog sessionId={id!} />
        </div>
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

      <Dialog open={!!reverseTarget} onOpenChange={(o) => !o && setReverseTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reverter movimento</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Esta ação cria um movimento contrário irreversível. Indique um motivo.
            </p>
            <div>
              <Label>Motivo</Label>
              <Input
                value={reverseTarget?.reason ?? ""}
                onChange={(e) => setReverseTarget((t) => t ? { ...t, reason: e.target.value } : t)}
                placeholder="Ex: lançado por engano"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReverseTarget(null)} disabled={reversing}>Cancelar</Button>
            <Button variant="destructive" onClick={reverseMove} disabled={reversing}>
              <Undo2 className="h-4 w-4 mr-1" /> {reversing ? "A reverter…" : "Reverter"}
            </Button>
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
