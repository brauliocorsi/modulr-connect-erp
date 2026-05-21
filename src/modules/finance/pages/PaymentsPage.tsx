import { useEffect, useRef, useState } from "react";
import { usePaymentsRealtime } from "@/core/realtime";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { CheckCircle2, Banknote, Link2, Plus, RefreshCw, XCircle } from "lucide-react";

/**
 * F24-B — PaymentsPage refatorada com três áreas estritamente separadas:
 *   1. Caixa físico             → cash sessions + cash movements cash-only
 *   2. Pagamentos pendentes     → customer_payments non-cash a confirmar/rejeitar
 *   3. Conciliação bancária     → bank_reconciliation_lines + match RPC
 *
 * Toda a lógica FIFO/sangria que liberava pagamentos bancários foi REMOVIDA.
 * Não há writes diretos; só leituras e RPCs.
 */
export default function PaymentsPage() {
  const [cashSessions, setCashSessions] = useState<any[]>([]);
  const [cashMovements, setCashMovements] = useState<any[]>([]);
  const [pendingPayments, setPendingPayments] = useState<any[]>([]);
  const [reconLines, setReconLines] = useState<any[]>([]);
  const [postedNonCash, setPostedNonCash] = useState<any[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    const [sess, mov, pending, lines, posted] = await Promise.all([
      supabase
        .from("cash_sessions")
        .select("id, name, state, opened_at, closed_at, opening_balance, closing_balance_counted, difference, cash_registers(name)")
        .order("opened_at", { ascending: false })
        .limit(50),
      supabase
        .from("cash_movements")
        .select("id, session_id, kind, amount, reference, created_at, migration_note, payment_id, cash_sessions(name), customer_payments(method_id, payment_methods(code, name, feeds_cash_session))")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("customer_payments")
        .select("id, name, payment_date, amount, state, reference, partner_id, order_id, payment_methods(code, name, feeds_cash_session, journal_type, requires_reference), partners(name), sale_orders(name)")
        .in("state", ["pending", "pending_delivery"])
        .order("payment_date", { ascending: false })
        .limit(200),
      supabase
        .from("bank_reconciliation_lines")
        .select("id, batch_id, payment_id, amount, reference, occurred_at, status, direction, notes, customer_payments(name, partners(name))")
        .order("occurred_at", { ascending: false })
        .limit(200),
      supabase
        .from("customer_payments")
        .select("id, name, payment_date, amount, reference, partner_id, reconciliation_status, reconciled_at, payment_methods(code, name, requires_reconciliation), partners(name)")
        .eq("state", "posted")
        .is("reconciled_at", null)
        .order("payment_date", { ascending: false })
        .limit(200),
    ]);
    setCashSessions(sess.data ?? []);
    setCashMovements(mov.data ?? []);
    setPendingPayments(pending.data ?? []);
    setReconLines(lines.data ?? []);
    setPostedNonCash((posted.data ?? []).filter((p: any) => p.payment_methods?.requires_reconciliation));
  };
  useEffect(() => { load(); }, []);

  // F26-B realtime — re-load when payments/cash/reconciliation change anywhere.
  const loadRef = useRef(load);
  loadRef.current = load;
  usePaymentsRealtime({ onChange: () => { void loadRef.current(); } });



  // ── Pagamentos pendentes ────────────────────────────────────────────
  const confirmPending = async (id: string) => {
    const { error } = await supabase.rpc("confirm_pending_payment", { _payment: id });
    if (error) return toast.error(error.message);
    toast.success("Pagamento confirmado");
    load();
  };
  const rejectPending = async (id: string) => {
    const reason = window.prompt("Motivo para rejeitar este pagamento:");
    if (!reason || !reason.trim()) return toast.error("Motivo obrigatório");
    const { error } = await supabase.rpc("cancel_customer_payment", { _payment_id: id, _reason: reason.trim() });
    if (error) return toast.error(error.message);
    toast.success("Pagamento rejeitado");
    load();
  };

  // ── Conciliação bancária ───────────────────────────────────────────
  const unmatchLine = async (id: string) => {
    const reason = window.prompt("Motivo para desfazer esta conciliação:");
    if (!reason || !reason.trim()) return toast.error("Motivo obrigatório");
    const { error } = await supabase.rpc("bank_reconciliation_unmatch", { _line_id: id, _reason: reason.trim() });
    if (error) return toast.error(error.message);
    toast.success("Conciliação desfeita");
    load();
  };

  const matchLine = async (lineId: string, paymentId: string) => {
    const { error } = await supabase.rpc("bank_reconciliation_match_customer_payment", { _line_id: lineId, _payment_id: paymentId });
    if (error) return toast.error(error.message);
    toast.success("Pagamento conciliado");
    load();
  };

  // ── Render ──────────────────────────────────────────────────────────
  const cashOnlyMovements = cashMovements.filter((m) => {
    if (m.migration_note === "non_cash_legacy") return false;
    if (!m.payment_id) return true;
    return m.customer_payments?.payment_methods?.feeds_cash_session !== false;
  });

  const pendingCount = pendingPayments.length;
  const reconPending = reconLines.filter((l) => l.status === "pending").length;
  const reconMatched = reconLines.filter((l) => l.status === "matched").length;

  return (
    <>
      <PageHeader
        title="Recebimentos & Caixa"
        breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Recebimentos" }]}
        actions={<Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Atualizar</Button>}
      />
      <PageBody>
        <Tabs defaultValue="cash">
          <TabsList>
            <TabsTrigger value="cash"><Banknote className="h-4 w-4 mr-1" />Caixa físico ({cashSessions.filter((s) => s.state === "open").length} abertas)</TabsTrigger>
            <TabsTrigger value="pending">Pagamentos pendentes ({pendingCount})</TabsTrigger>
            <TabsTrigger value="recon"><Link2 className="h-4 w-4 mr-1" />Conciliação bancária ({reconPending} pendentes)</TabsTrigger>
          </TabsList>

          {/* ============= TAB 1 — CAIXA FÍSICO ============= */}
          <TabsContent value="cash">
            <Card className="mb-3">
              <div className="px-3 py-2 text-sm font-semibold border-b">Sessões de caixa</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Sessão</th>
                    <th className="text-left px-3 py-2">Caixa</th>
                    <th className="text-left px-3 py-2">Estado</th>
                    <th className="text-left px-3 py-2">Aberta</th>
                    <th className="text-left px-3 py-2">Fechada</th>
                    <th className="text-right px-3 py-2">Abertura</th>
                    <th className="text-right px-3 py-2">Contado</th>
                    <th className="text-right px-3 py-2">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {cashSessions.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sem sessões</td></tr>
                  ) : cashSessions.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link to={`/cashbox/sessions/${s.id}`} className="text-primary hover:underline">{s.name}</Link>
                      </td>
                      <td className="px-3 py-2">{s.cash_registers?.name ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${s.state === "open" ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground"}`}>{s.state}</span>
                      </td>
                      <td className="px-3 py-2">{s.opened_at?.slice(0, 16).replace("T", " ")}</td>
                      <td className="px-3 py-2">{s.closed_at?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.opening_balance)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.closing_balance_counted != null ? fmtMoney(s.closing_balance_counted) : "—"}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${Math.abs(s.difference ?? 0) > 0.01 ? "text-amber-600 font-semibold" : ""}`}>{s.difference != null ? fmtMoney(s.difference) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card>
              <div className="px-3 py-2 text-sm font-semibold border-b">Movimentos de caixa (cash-only)</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Data</th>
                    <th className="text-left px-3 py-2">Sessão</th>
                    <th className="text-left px-3 py-2">Tipo</th>
                    <th className="text-left px-3 py-2">Método</th>
                    <th className="text-left px-3 py-2">Ref.</th>
                    <th className="text-right px-3 py-2">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {cashOnlyMovements.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Sem movimentos de caixa</td></tr>
                  ) : cashOnlyMovements.slice(0, 200).map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap text-xs">{new Date(m.created_at).toLocaleString("pt-PT")}</td>
                      <td className="px-3 py-2 font-mono text-xs">{m.cash_sessions?.name ?? "—"}</td>
                      <td className="px-3 py-2">{m.kind}</td>
                      <td className="px-3 py-2">{m.customer_payments?.payment_methods?.name ?? "—"}</td>
                      <td className="px-3 py-2">{m.reference ?? "—"}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${m.amount < 0 ? "text-rose-600" : ""}`}>{fmtMoney(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          {/* ============= TAB 2 — PAGAMENTOS PENDENTES ============= */}
          <TabsContent value="pending">
            <Card>
              <div className="px-3 py-2 text-sm font-semibold border-b">Pagamentos não-caixa a confirmar</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Nº</th>
                    <th className="text-left px-3 py-2">Data</th>
                    <th className="text-left px-3 py-2">Cliente</th>
                    <th className="text-left px-3 py-2">Venda</th>
                    <th className="text-left px-3 py-2">Método</th>
                    <th className="text-left px-3 py-2">Ref.</th>
                    <th className="text-right px-3 py-2">Valor</th>
                    <th className="text-right px-3 py-2 w-56"></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingPayments.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sem pagamentos pendentes</td></tr>
                  ) : pendingPayments.map((p) => {
                    const m = p.payment_methods;
                    const refMissing = m?.requires_reference && !p.reference;
                    return (
                      <tr key={p.id} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">{p.name}</td>
                        <td className="px-3 py-2">{p.payment_date}</td>
                        <td className="px-3 py-2">{p.partners?.name ?? "—"}</td>
                        <td className="px-3 py-2">{p.sale_orders ? <Link to={`/sales/orders/${p.order_id}`} className="text-primary hover:underline">{p.sale_orders.name}</Link> : "—"}</td>
                        <td className="px-3 py-2">
                          {m?.name ?? "—"}
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-muted">{m?.journal_type ?? ""}</span>
                        </td>
                        <td className="px-3 py-2">
                          {p.reference ?? <span className="text-rose-600 text-xs">{refMissing ? "obrigatória" : "—"}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.amount)}</td>
                        <td className="px-3 py-2 text-right space-x-1">
                          <Button size="sm" variant="ghost" onClick={() => rejectPending(p.id)}>
                            <XCircle className="h-4 w-4 mr-1" />Rejeitar
                          </Button>
                          <Button size="sm" onClick={() => confirmPending(p.id)} disabled={refMissing}>
                            <CheckCircle2 className="h-4 w-4 mr-1" />Confirmar
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          {/* ============= TAB 3 — CONCILIAÇÃO BANCÁRIA ============= */}
          <TabsContent value="recon">
            <Card className="p-3 mb-3 flex items-center gap-2">
              <div className="text-sm text-muted-foreground">
                <strong>{reconPending}</strong> pendentes · <strong>{reconMatched}</strong> conciliadas · <strong>{postedNonCash.length}</strong> pagamentos posted aguardam conciliação
              </div>
              <Button size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />Nova linha
              </Button>
            </Card>

            <Card>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Data</th>
                    <th className="text-left px-3 py-2">Sentido</th>
                    <th className="text-left px-3 py-2">Ref.</th>
                    <th className="text-right px-3 py-2">Valor</th>
                    <th className="text-left px-3 py-2">Pagamento</th>
                    <th className="text-left px-3 py-2 w-32">Estado</th>
                    <th className="text-right px-3 py-2 w-72"></th>
                  </tr>
                </thead>
                <tbody>
                  {reconLines.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sem linhas de conciliação</td></tr>
                  ) : reconLines.map((l) => (
                    <tr key={l.id} className="border-t align-top">
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(l.occurred_at).toLocaleDateString("pt-PT")}</td>
                      <td className="px-3 py-2">{l.direction === "incoming" ? "Entrada" : "Saída"}</td>
                      <td className="px-3 py-2">{l.reference ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.amount)}</td>
                      <td className="px-3 py-2">
                        {l.payment_id ? (
                          <span className="text-xs">
                            <span className="font-mono">{l.customer_payments?.name}</span> · {l.customer_payments?.partners?.name ?? "—"}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          l.status === "matched" ? "bg-emerald-100 text-emerald-900" :
                          l.status === "pending" ? "bg-blue-100 text-blue-900" :
                          "bg-muted text-muted-foreground"
                        }`}>{l.status}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {l.status === "matched" ? (
                          <Button size="sm" variant="ghost" onClick={() => unmatchLine(l.id)}>Desfazer</Button>
                        ) : l.status === "pending" ? (
                          <MatchPicker line={l} candidates={postedNonCash} onMatch={matchLine} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </TabsContent>
        </Tabs>

        <CreateReconLineDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
      </PageBody>
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function MatchPicker({ line, candidates, onMatch }: { line: any; candidates: any[]; onMatch: (lineId: string, paymentId: string) => void }) {
  const eligible = candidates.filter((c) => Math.abs(Number(c.amount) - Number(line.amount)) < 0.01);
  const [sel, setSel] = useState<string>("");
  if (eligible.length === 0) return <span className="text-xs text-muted-foreground">Sem candidato</span>;
  return (
    <div className="flex items-center gap-1 justify-end">
      <Select value={sel} onValueChange={setSel}>
        <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder="Escolher pagamento…" /></SelectTrigger>
        <SelectContent>
          {eligible.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name} · {c.partners?.name ?? "—"}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" disabled={!sel} onClick={() => onMatch(line.id, sel)}>Conciliar</Button>
    </div>
  );
}

function CreateReconLineDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [amount, setAmount] = useState<number>(0);
  const [reference, setReference] = useState("");
  const [direction, setDirection] = useState<"incoming" | "outgoing">("incoming");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!amount || amount <= 0) return toast.error("Valor inválido");
    setSaving(true);
    const { error } = await supabase.rpc("bank_reconciliation_line_create", {
      _payload: { amount, reference: reference || null, direction, notes: notes || null },
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Linha criada");
    setAmount(0); setReference(""); setNotes("");
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova linha de conciliação bancária</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Sentido</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="incoming">Entrada</SelectItem>
                  <SelectItem value="outgoing">Saída</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label>Referência bancária</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex: TRF 1234567" />
          </div>
          <div>
            <Label>Notas</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "A criar…" : "Criar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
