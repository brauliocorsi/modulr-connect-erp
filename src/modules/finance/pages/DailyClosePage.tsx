/**
 * F29 Bloco 1 — Fecho do Dia
 * Painel matinal do gestor financeiro.
 * Rota: /finance/daily
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FinanceHero, type FinanceHeroKpi } from "@/core/finance/FinanceHero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RegisterSupplierPaymentDialog } from "@/modules/finance/components/RegisterSupplierPaymentDialog";
import { Wallet, AlertTriangle, Truck, Clock } from "lucide-react";

const REFRESH_MS = 60_000;

const fmtEUR = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(n ?? 0));
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("pt-PT") : "—";

type CashRegisterRow = { id: string; name: string; store_id: string | null; driver_id: string | null; warehouse_id: string | null };
type OpenSession = {
  id: string;
  name: string;
  opened_at: string;
  opening_balance: number;
  closing_balance_theoretical: number | null;
  register: CashRegisterRow | null;
};

type ClosureRow = {
  id: string;
  route_id: string;
  expected_cash: number; actual_cash: number;
  expected_mbway: number; actual_mbway: number;
  expected_transfer: number; actual_transfer: number;
  expected_other: number; actual_other: number;
  variance: number;
  reconciled_at: string | null;
  closed_at: string | null;
  route: { route_date: string; driver_id: string | null } | null;
};

type SupplierBill = {
  id: string; name: string; amount_total: number; amount_paid: number; due_date: string | null; state: string;
  partner: { name: string } | null;
};

type BnplRow = {
  id: string; name: string; cliente: string | null; venda: string | null;
  expected_settlement_date: string; amount_gross: number; amount_net: number; fee_amount: number;
  metodo: string; reconciled_at: string | null;
};

function registerType(r: CashRegisterRow | null): { label: string; tone: string } {
  if (!r) return { label: "—", tone: "bg-muted text-muted-foreground" };
  if (r.driver_id) return { label: "Entregador", tone: "bg-amber-100 text-amber-900" };
  if (r.store_id) return { label: "Loja", tone: "bg-emerald-100 text-emerald-900" };
  if (r.warehouse_id) return { label: "Armazém", tone: "bg-indigo-100 text-indigo-900" };
  return { label: "Outro", tone: "bg-muted text-muted-foreground" };
}

function varianceTone(v: number) {
  if (v === 0) return "text-emerald-600";
  if (v < 0) return "text-red-600 font-semibold";
  return "text-amber-600";
}

export default function DailyClosePage() {
  const [payingBill, setPayingBill] = useState<SupplierBill | null>(null);

  const openSessionsQ = useQuery({
    queryKey: ["fd-open-sessions"],
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<OpenSession[]> => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("id,name,opened_at,opening_balance,closing_balance_theoretical,register:cash_registers(id,name,store_id,driver_id,warehouse_id)")
        .eq("state", "open")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OpenSession[];
    },
  });

  const closuresQ = useQuery({
    queryKey: ["fd-closures-pending"],
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<ClosureRow[]> => {
      const { data, error } = await supabase
        .from("delivery_route_cash_closure")
        .select("id,route_id,expected_cash,actual_cash,expected_mbway,actual_mbway,expected_transfer,actual_transfer,expected_other,actual_other,variance,reconciled_at,closed_at,route:delivery_routes(route_date,driver_id)")
        .is("reconciled_at", null)
        .order("closed_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as ClosureRow[];
    },
  });

  const billsQ = useQuery({
    queryKey: ["fd-bills-due"],
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<SupplierBill[]> => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("supplier_bills")
        .select("id,name,amount_total,amount_paid,due_date,state,partner:partners(name)")
        .neq("state", "paid")
        .lte("due_date", today)
        .order("due_date", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as SupplierBill[];
    },
  });

  const bnplQ = useQuery({
    queryKey: ["fd-bnpl-pending"],
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<BnplRow[]> => {
      const { data, error } = await supabase
        .from("bnpl_pending_settlements" as never)
        .select("id,name,cliente,venda,expected_settlement_date,amount_gross,amount_net,fee_amount,metodo,reconciled_at")
        .is("reconciled_at", null)
        .order("expected_settlement_date", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as BnplRow[];
    },
  });

  const kpis: FinanceHeroKpi[] = [
    {
      key: "sessions",
      label: "Caixas abertas",
      value: String(openSessionsQ.data?.length ?? "—"),
      hint: openSessionsQ.data
        ? fmtEUR(openSessionsQ.data.reduce((s, r) => s + Number(r.closing_balance_theoretical ?? r.opening_balance ?? 0), 0)) + " teórico"
        : undefined,
    },
    {
      key: "closures",
      label: "Entregas por reconciliar",
      value: String(closuresQ.data?.length ?? "—"),
      tone: (closuresQ.data?.length ?? 0) > 0 ? "gold" : "default",
    },
    {
      key: "bills",
      label: "Contas a pagar hoje",
      value: String(billsQ.data?.length ?? "—"),
      hint: billsQ.data ? fmtEUR(billsQ.data.reduce((s, r) => s + (Number(r.amount_total) - Number(r.amount_paid)), 0)) : undefined,
      tone: (billsQ.data?.length ?? 0) > 0 ? "danger" : "default",
    },
    {
      key: "bnpl",
      label: "BNPL por liquidar",
      value: String(bnplQ.data?.length ?? "—"),
      hint: bnplQ.data ? fmtEUR(bnplQ.data.reduce((s, r) => s + Number(r.amount_net ?? 0), 0)) + " líq." : undefined,
    },
  ];

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <FinanceHero
        eyebrow="Operação diária"
        title="Fecho do Dia"
        subtitle="Painel matinal — caixas, reconciliações, dívidas e liquidações BNPL."
        kpis={kpis}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* Caixas abertas */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Caixas abertas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openSessionsQ.isLoading ? (
              <div className="text-sm text-muted-foreground">A carregar…</div>
            ) : (openSessionsQ.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Nenhuma caixa aberta.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Caixa</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Abertura</TableHead>
                    <TableHead className="text-right">Saldo teórico</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openSessionsQ.data!.map((s) => {
                    const t = registerType(s.register);
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.register?.name ?? s.name}</TableCell>
                        <TableCell><Badge variant="secondary" className={t.tone}>{t.label}</Badge></TableCell>
                        <TableCell>{new Date(s.opened_at).toLocaleString("pt-PT")}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtEUR(s.closing_balance_theoretical ?? s.opening_balance)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/cashbox/sessions/${s.id}`}>Ver</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Entregas por reconciliar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="h-4 w-4" /> Entregas por reconciliar
            </CardTitle>
          </CardHeader>
          <CardContent>
            {closuresQ.isLoading ? (
              <div className="text-sm text-muted-foreground">A carregar…</div>
            ) : (closuresQ.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Sem reconciliações pendentes.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rota</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">Real</TableHead>
                    <TableHead className="text-right">Variância</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closuresQ.data!.map((c) => {
                    const exp = c.expected_cash + c.expected_mbway + c.expected_transfer + c.expected_other;
                    const real = c.actual_cash + c.actual_mbway + c.actual_transfer + c.actual_other;
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.route_id.slice(0, 8)}</TableCell>
                        <TableCell>{fmtDate(c.route?.route_date)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtEUR(exp)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtEUR(real)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${varianceTone(c.variance)}`}>{fmtEUR(c.variance)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/delivery/routes/${c.route_id}/cash-close`}>Abrir</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Contas a pagar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Contas a pagar (vencidas e hoje)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {billsQ.isLoading ? (
              <div className="text-sm text-muted-foreground">A carregar…</div>
            ) : (billsQ.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Sem contas a pagar pendentes.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Fatura</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Em dívida</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billsQ.data!.map((b) => {
                    const overdue = b.due_date && b.due_date < today;
                    return (
                      <TableRow key={b.id} className={overdue ? "bg-red-50/50" : ""}>
                        <TableCell className="font-medium">{b.partner?.name ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <Link className="hover:underline" to={`/finance/payables/${b.id}`}>{b.name}</Link>
                        </TableCell>
                        <TableCell className={overdue ? "text-red-600 font-medium" : ""}>{fmtDate(b.due_date)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtEUR(Number(b.amount_total) - Number(b.amount_paid))}</TableCell>
                        <TableCell>
                          <Button size="sm" onClick={() => setPayingBill(b)}>Pagar</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* BNPL */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" /> BNPL pendente de liquidação
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bnplQ.isLoading ? (
              <div className="text-sm text-muted-foreground">A carregar…</div>
            ) : (bnplQ.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Nenhum pagamento BNPL pendente.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Venda</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Liquidação prevista</TableHead>
                    <TableHead className="text-right">Bruto</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bnplQ.data!.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.venda ?? r.name}</TableCell>
                      <TableCell>{r.cliente ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{r.metodo}</Badge></TableCell>
                      <TableCell>{fmtDate(r.expected_settlement_date)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtEUR(r.amount_gross)}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700 font-medium">{fmtEUR(r.amount_net)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {payingBill && (
        <RegisterSupplierPaymentDialog
          open={!!payingBill}
          onOpenChange={(v) => !v && setPayingBill(null)}
          billId={payingBill.id}
          defaultAmount={Number(payingBill.amount_total) - Number(payingBill.amount_paid)}
          onSaved={() => {
            setPayingBill(null);
            billsQ.refetch();
          }}
        />
      )}
    </div>
  );
}
