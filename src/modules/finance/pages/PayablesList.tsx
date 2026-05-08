import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { fmtMoney } from "@/lib/format";

const STATE_LABEL: Record<string, string> = {
  draft: "Rascunho", posted: "Lançada", partial: "Parcial", paid: "Paga", cancelled: "Cancelada",
};

export default function PayablesList() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("supplier_bills")
        .select("*, partners(name), cost_centers(name)")
        .order("bill_date", { ascending: false })
        .limit(500);
      setRows(data ?? []);
    })();
  }, []);

  const groups = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return {
      all: rows,
      pending: rows.filter((r) => ["draft", "posted", "partial"].includes(r.state)),
      overdue: rows.filter((r) => r.due_date && new Date(r.due_date) < today && r.state !== "paid" && r.state !== "cancelled"),
      paid: rows.filter((r) => r.state === "paid"),
    };
  }, [rows]);

  const Table = ({ data }: { data: any[] }) => (
    <Card>
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2">Nº</th>
            <th className="text-left px-3 py-2">Fornecedor</th>
            <th className="text-left px-3 py-2">Data</th>
            <th className="text-left px-3 py-2">Vencimento</th>
            <th className="text-right px-3 py-2">Total</th>
            <th className="text-right px-3 py-2">Pago</th>
            <th className="text-right px-3 py-2">Em aberto</th>
            <th className="text-left px-3 py-2">Estado</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sem registos</td></tr>
          ) : data.map((b) => {
            const open = Number(b.amount_total) - Number(b.amount_paid);
            return (
              <tr key={b.id} className="border-t hover:bg-muted/40 cursor-pointer" onClick={() => nav(`/finance/payables/${b.id}`)}>
                <td className="px-3 py-2 font-mono">{b.name}</td>
                <td className="px-3 py-2">{b.partners?.name ?? "—"}</td>
                <td className="px-3 py-2">{b.bill_date}</td>
                <td className="px-3 py-2">{b.due_date ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(b.amount_total)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(b.amount_paid)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtMoney(open)}</td>
                <td className="px-3 py-2">{STATE_LABEL[b.state] ?? b.state}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );

  return (
    <>
      <PageHeader
        title="Contas a Pagar"
        breadcrumb={[{ label: "Financeiro", to: "/finance" }, { label: "Contas a Pagar" }]}
        actions={<Button size="sm" onClick={() => nav("/finance/payables/new")}><Plus className="h-4 w-4 mr-1" /> Nova fatura</Button>}
      />
      <PageBody>
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">A pagar ({groups.pending.length})</TabsTrigger>
            <TabsTrigger value="overdue">Vencidas ({groups.overdue.length})</TabsTrigger>
            <TabsTrigger value="paid">Pagas ({groups.paid.length})</TabsTrigger>
            <TabsTrigger value="all">Todas ({groups.all.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="pending"><Table data={groups.pending} /></TabsContent>
          <TabsContent value="overdue"><Table data={groups.overdue} /></TabsContent>
          <TabsContent value="paid"><Table data={groups.paid} /></TabsContent>
          <TabsContent value="all"><Table data={groups.all} /></TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
