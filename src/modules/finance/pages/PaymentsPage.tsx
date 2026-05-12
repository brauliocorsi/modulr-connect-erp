import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fmtMoney } from "@/lib/format";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

const isCashName = (n?: string) => {
  const s = (n ?? "").toLowerCase();
  return ["dinheiro", "cash", "numerário", "numerario"].some((c) => s.includes(c));
};

type ReconRow = {
  id: string;
  session_id: string;
  session_name: string;
  register_name: string;
  created_at: string;
  amount: number;
  method: string;
  reference: string | null;
  partner: string | null;
  reconciled_at: string | null;
  eligible: boolean;
  block_reason?: string;
  kind: string;
  is_withdrawal: boolean;
};

type SessionSummary = {
  session_id: string;
  session_name: string;
  register_name: string;
  cashSales: number;
  sangria: number;
  eligibleCash: number;
  diff: number;
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [recon, setRecon] = useState<ReconRow[]>([]);
  const [sessionSummaries, setSessionSummaries] = useState<SessionSummary[]>([]);
  const [reconFilter, setReconFilter] = useState<"pending" | "reconciled" | "all">("pending");

  const load = async () => {
    const { data } = await supabase
      .from("customer_payments")
      .select("id,name,payment_date,amount,state,reference,partner_id,order_id, payment_methods(name), account_journals(name), partners(name), sale_orders(name)")
      .order("payment_date", { ascending: false })
      .limit(500);
    setPayments(data ?? []);

    const { data: sched } = await supabase
      .from("sale_payment_schedules")
      .select("id,label,due_kind,due_date,due_days,amount,paid_amount,state,order_id, sale_orders(id,name,partner_id, partners(name))")
      .neq("state", "paid")
      .order("created_at");
    setPending(sched ?? []);

    // Cash movements grouped by session for reconciliation
    const { data: moves, error: movesErr } = await supabase
      .from("cash_movements")
      .select("id, session_id, kind, amount, reference, created_at, reconciled_at, partner_id, payment_id")
      .in("kind", ["sale", "sangria", "withdrawal", "deposit", "cash_in"])
      .order("created_at", { ascending: false })
      .limit(1000);
    if (movesErr) console.error("cash_movements error", movesErr);

    const list = (moves ?? []) as any[];

    // Hydrate related data without relying on FK embeds
    const sessionIds = Array.from(new Set(list.map((m) => m.session_id).filter(Boolean)));
    const partnerIds = Array.from(new Set(list.map((m) => m.partner_id).filter(Boolean)));
    const paymentIds = Array.from(new Set(list.map((m) => m.payment_id).filter(Boolean)));

    const [sessRes, partRes, payRes] = await Promise.all([
      sessionIds.length
        ? supabase.from("cash_sessions").select("id, name, register_id").in("id", sessionIds)
        : Promise.resolve({ data: [] as any[] }),
      partnerIds.length
        ? supabase.from("partners").select("id, name").in("id", partnerIds)
        : Promise.resolve({ data: [] as any[] }),
      paymentIds.length
        ? supabase.from("customer_payments").select("id, method_id").in("id", paymentIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const sessionsMap = new Map<string, any>((sessRes.data ?? []).map((s: any) => [s.id, s]));
    const partnersMap = new Map<string, any>((partRes.data ?? []).map((p: any) => [p.id, p]));
    const paymentsMap = new Map<string, any>((payRes.data ?? []).map((p: any) => [p.id, p]));

    const registerIds = Array.from(new Set(Array.from(sessionsMap.values()).map((s: any) => s.register_id).filter(Boolean)));
    const methodIds = Array.from(new Set(Array.from(paymentsMap.values()).map((p: any) => p.method_id).filter(Boolean)));
    const [regRes, methRes] = await Promise.all([
      registerIds.length
        ? supabase.from("cash_registers").select("id, name").in("id", registerIds)
        : Promise.resolve({ data: [] as any[] }),
      methodIds.length
        ? supabase.from("payment_methods").select("id, name").in("id", methodIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const registersMap = new Map<string, any>((regRes.data ?? []).map((r: any) => [r.id, r]));
    const methodsMap = new Map<string, any>((methRes.data ?? []).map((m: any) => [m.id, m]));

    // Attach helpers onto each move
    for (const m of list) {
      const sess = sessionsMap.get(m.session_id);
      const reg = sess ? registersMap.get(sess.register_id) : null;
      const pay = m.payment_id ? paymentsMap.get(m.payment_id) : null;
      const method = pay ? methodsMap.get(pay.method_id) : null;
      m.__session = sess;
      m.__register = reg;
      m.__method = method;
      m.__partner = m.partner_id ? partnersMap.get(m.partner_id) : null;
    }
    // Compute eligibility: non-cash payments are always eligible.
    // Cash sale/cash_in entries become eligible up to the absolute sum of sangrias/withdrawals in the same session.
    const bySession = new Map<string, any[]>();
    for (const m of list) {
      const arr = bySession.get(m.session_id) ?? [];
      arr.push(m);
      bySession.set(m.session_id, arr);
    }

    const out: ReconRow[] = [];
    const summaries: SessionSummary[] = [];
    for (const [sid, arr] of bySession) {
      // Cash withdrawals available pool (positive number)
      const sangriaPool = arr
        .filter((m) => ["sangria", "withdrawal"].includes(m.kind))
        .reduce((s, m) => s + Math.abs(Number(m.amount || 0)), 0);

      // Sort cash sale entries by created_at to allocate sangria pool FIFO
      const cashEntries = arr
        .filter((m) => isCashName(m.__method?.name) && Number(m.amount) > 0 && !["sangria","withdrawal"].includes(m.kind))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      const cashSalesTotal = cashEntries.reduce((s, m) => s + Number(m.amount || 0), 0);

      let remainingPool = sangriaPool;
      const cashEligibleIds = new Set<string>();
      let eligibleCashTotal = 0;
      for (const c of cashEntries) {
        const amt = Number(c.amount || 0);
        if (remainingPool >= amt - 0.01) {
          cashEligibleIds.add(c.id);
          remainingPool -= amt;
          eligibleCashTotal += amt;
        }
      }

      const firstSess = arr.find((m) => m.__session) ?? arr[0];
      summaries.push({
        session_id: sid,
        session_name: firstSess?.__session?.name ?? "—",
        register_name: firstSess?.__register?.name ?? "—",
        cashSales: cashSalesTotal,
        sangria: sangriaPool,
        eligibleCash: eligibleCashTotal,
        diff: cashSalesTotal - sangriaPool,
      });

      for (const m of arr) {
        const isWithdrawal = ["sangria", "withdrawal"].includes(m.kind);
        const methodName = m.__method?.name
          ?? (isWithdrawal ? "Sangria/Retirada" : "—");
        const isCash = isCashName(methodName) || isWithdrawal;

        let eligible = true;
        let block_reason: string | undefined;
        if (isWithdrawal) {
          // Sangrias are themselves financial movements that go to reconciliation (they unlock cash)
          eligible = true;
        } else if (isCash) {
          eligible = cashEligibleIds.has(m.id);
          if (!eligible) block_reason = "Aguarda sangria de caixa";
        }

        out.push({
          id: m.id,
          session_id: sid,
          session_name: m.__session?.name ?? "—",
          register_name: m.__register?.name ?? "—",
          created_at: m.created_at,
          amount: Number(m.amount || 0),
          method: methodName,
          reference: m.reference,
          partner: m.__partner?.name ?? null,
          reconciled_at: m.reconciled_at,
          eligible,
          block_reason,
          kind: m.kind,
          is_withdrawal: isWithdrawal,
        });
      }
    }
    out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setRecon(out);
    setSessionSummaries(summaries.sort((a, b) => a.session_name.localeCompare(b.session_name)));
  };

  useEffect(() => { load(); }, []);

  const reconcileOne = async (id: string) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("cash_movements")
      .update({ reconciled_at: new Date().toISOString(), reconciled_by: u.user?.id ?? null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Movimento conciliado");
    load();
  };

  const undoReconcile = async (id: string) => {
    const { error } = await supabase
      .from("cash_movements")
      .update({ reconciled_at: null, reconciled_by: null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Conciliação removida");
    load();
  };

  const reconcileAllEligible = async () => {
    const ids = recon.filter((r) => r.eligible && !r.reconciled_at).map((r) => r.id);
    if (ids.length === 0) return toast.info("Nada elegível para conciliar");
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("cash_movements")
      .update({ reconciled_at: new Date().toISOString(), reconciled_by: u.user?.id ?? null })
      .in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`${ids.length} movimentos conciliados`);
    load();
  };

  const filteredRecon = recon.filter((r) => {
    if (reconFilter === "pending") return !r.reconciled_at;
    if (reconFilter === "reconciled") return !!r.reconciled_at;
    return true;
  });

  const reconCounts = {
    pending: recon.filter((r) => !r.reconciled_at).length,
    eligible: recon.filter((r) => r.eligible && !r.reconciled_at).length,
    reconciled: recon.filter((r) => r.reconciled_at).length,
  };

  return (
    <>
      <PageHeader title="Recebimentos" breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Recebimentos" }]} />
      <PageBody>
        <Tabs defaultValue="received">
          <TabsList>
            <TabsTrigger value="received">Recebidos ({payments.length})</TabsTrigger>
            <TabsTrigger value="pending">Por Receber ({pending.length})</TabsTrigger>
            <TabsTrigger value="recon">Conciliação de caixa ({reconCounts.pending})</TabsTrigger>
          </TabsList>

          <TabsContent value="received">
            <Card>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Nº</th>
                    <th className="text-left px-3 py-2">Data</th>
                    <th className="text-left px-3 py-2">Cliente</th>
                    <th className="text-left px-3 py-2">Venda</th>
                    <th className="text-left px-3 py-2">Método</th>
                    <th className="text-left px-3 py-2">Diário</th>
                    <th className="text-right px-3 py-2">Valor</th>
                    <th className="text-left px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sem recebimentos</td></tr>
                  ) : payments.map((p) => (
                    <tr key={p.id} className={`border-t ${p.state === "cancelled" ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 font-mono">{p.name}</td>
                      <td className="px-3 py-2">{p.payment_date}</td>
                      <td className="px-3 py-2">{p.partners?.name ?? "—"}</td>
                      <td className="px-3 py-2">
                        {p.sale_orders ? <Link to={`/sales/orders/${p.order_id}`} className="text-primary hover:underline">{p.sale_orders.name}</Link> : "—"}
                      </td>
                      <td className="px-3 py-2">{p.payment_methods?.name ?? "—"}</td>
                      <td className="px-3 py-2">{p.account_journals?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(p.amount)}</td>
                      <td className="px-3 py-2">{p.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          <TabsContent value="pending">
            <Card>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Venda</th>
                    <th className="text-left px-3 py-2">Cliente</th>
                    <th className="text-left px-3 py-2">Parcela</th>
                    <th className="text-left px-3 py-2">Vencimento</th>
                    <th className="text-right px-3 py-2">Valor</th>
                    <th className="text-right px-3 py-2">Pago</th>
                    <th className="text-right px-3 py-2">Em aberto</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Tudo em dia</td></tr>
                  ) : pending.map((s) => {
                    const open = Number(s.amount || 0) - Number(s.paid_amount || 0);
                    const due =
                      s.due_kind === "fixed_date" ? (s.due_date ?? "—")
                      : s.due_kind === "on_confirm" ? "Na confirmação"
                      : s.due_kind === "on_delivery" ? "Na entrega"
                      : s.due_kind === "days_after_confirm" ? `${s.due_days ?? 0}d após confirmação`
                      : "—";
                    return (
                      <tr key={s.id} className="border-t">
                        <td className="px-3 py-2">
                          <Link to={`/sales/orders/${s.order_id}`} className="text-primary hover:underline">{s.sale_orders?.name}</Link>
                        </td>
                        <td className="px-3 py-2">{s.sale_orders?.partners?.name ?? "—"}</td>
                        <td className="px-3 py-2">{s.label}</td>
                        <td className="px-3 py-2">{due}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.paid_amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtMoney(open)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          <TabsContent value="recon">
            <Card className="p-3 mb-3 flex flex-wrap items-center gap-2">
              <div className="flex gap-1">
                <Button size="sm" variant={reconFilter === "pending" ? "default" : "outline"} onClick={() => setReconFilter("pending")}>
                  Pendentes ({reconCounts.pending})
                </Button>
                <Button size="sm" variant={reconFilter === "reconciled" ? "default" : "outline"} onClick={() => setReconFilter("reconciled")}>
                  Conciliados ({reconCounts.reconciled})
                </Button>
                <Button size="sm" variant={reconFilter === "all" ? "default" : "outline"} onClick={() => setReconFilter("all")}>
                  Todos ({recon.length})
                </Button>
              </div>
              <div className="ml-auto text-sm text-muted-foreground">
                <strong>{reconCounts.eligible}</strong> elegíveis (multibanco/cartão/transferência sempre; dinheiro só após sangria de caixa)
              </div>
              <Button size="sm" onClick={reconcileAllEligible} disabled={reconCounts.eligible === 0}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Conciliar elegíveis
              </Button>
            </Card>

            {sessionSummaries.length > 0 && (
              <Card className="p-3 mb-3">
                <div className="text-sm font-semibold mb-2">Cruzamento por sessão (dinheiro vs sangria)</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2">Sessão</th>
                        <th className="text-left px-3 py-2">Caixa</th>
                        <th className="text-right px-3 py-2">Vendas em dinheiro</th>
                        <th className="text-right px-3 py-2">Sangrias / Retiradas</th>
                        <th className="text-right px-3 py-2">Dinheiro elegível</th>
                        <th className="text-right px-3 py-2">Diferença</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionSummaries.map((s) => (
                        <tr key={s.session_id} className="border-t">
                          <td className="px-3 py-2 font-mono text-xs">{s.session_name}</td>
                          <td className="px-3 py-2">{s.register_name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.cashSales)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.sangria)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.eligibleCash)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-semibold ${Math.abs(s.diff) < 0.01 ? "text-emerald-600" : "text-amber-600"}`}>
                            {fmtMoney(s.diff)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <Card>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Data</th>
                    <th className="text-left px-3 py-2">Sessão</th>
                    <th className="text-left px-3 py-2">Caixa</th>
                    <th className="text-left px-3 py-2">Método</th>
                    <th className="text-left px-3 py-2">Cliente / Ref.</th>
                    <th className="text-right px-3 py-2">Valor</th>
                    <th className="text-left px-3 py-2 w-44">Estado</th>
                    <th className="text-right px-3 py-2 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecon.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sem movimentos</td></tr>
                  ) : filteredRecon.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString("pt-PT")}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.session_name}</td>
                      <td className="px-3 py-2">{r.register_name}</td>
                      <td className="px-3 py-2">{r.method}</td>
                      <td className="px-3 py-2">{r.partner ?? r.reference ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.amount)}</td>
                      <td className="px-3 py-2">
                        {r.reconciled_at ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                            <CheckCircle2 className="h-3 w-3" /> Conciliado
                          </span>
                        ) : r.eligible ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200">Elegível</span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" title={r.block_reason}>
                            {r.block_reason ?? "Bloqueado"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.reconciled_at ? (
                          <Button size="sm" variant="ghost" onClick={() => undoReconcile(r.id)}>Reabrir</Button>
                        ) : (
                          <Button size="sm" disabled={!r.eligible} onClick={() => reconcileOne(r.id)}>Conciliar</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
