import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
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
import { Play } from "lucide-react";

export default function CashRegisterDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [reg, setReg] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [openSession, setOpenSession] = useState<any | null>(null);
  const [openDlg, setOpenDlg] = useState(false);
  const [openingBalance, setOpeningBalance] = useState<string>("");
  const [lastClosed, setLastClosed] = useState<number>(0);

  const load = async () => {
    const { data: r } = await supabase
      .from("cash_registers")
      .select("*, warehouses(name), account_journals(name)")
      .eq("id", id!).maybeSingle();
    setReg(r);
    const { data: s } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("register_id", id!)
      .order("opened_at", { ascending: false });
    setSessions(s ?? []);
    setOpenSession((s ?? []).find((x: any) => x.state === "open") ?? null);
    const lastClosedSess = (s ?? []).find((x: any) => x.state === "closed");
    setLastClosed(Number(lastClosedSess?.closing_balance_counted ?? 0));
  };

  useEffect(() => { if (id) load(); }, [id]);

  const openNew = async () => {
    const opening = openingBalance === "" ? null : Number(openingBalance);
    const { data, error } = await supabase.rpc("open_cash_session", { _register: id!, _opening: opening });
    if (error) return toast.error(error.message);
    toast.success("Sessão aberta");
    setOpenDlg(false);
    setOpeningBalance("");
    if (data) nav(`/finance/cash/sessions/${data}`);
  };

  if (!reg) return <div className="p-6 text-muted-foreground">Carregando…</div>;

  return (
    <>
      <FormHeader
        title={reg.name}
        breadcrumb={[
          { label: "Financeiro", to: "/finance" },
          { label: "Caixas", to: "/finance/cash" },
          { label: reg.name },
        ]}
        backTo="/finance/cash"
        actions={
          openSession ? (
            <Button size="sm" onClick={() => nav(`/finance/cash/sessions/${openSession.id}`)}>
              Ver sessão aberta
            </Button>
          ) : (
            <Button size="sm" onClick={() => { setOpeningBalance(String(lastClosed)); setOpenDlg(true); }}>
              <Play className="h-4 w-4 mr-1" /> Abrir sessão
            </Button>
          )
        }
      />
      <PageBody>
        <Card className="p-4 grid sm:grid-cols-3 gap-3 mb-4 text-sm">
          <div><div className="o-section-title">Loja</div>{reg.warehouses?.name ?? "—"}</div>
          <div><div className="o-section-title">Diário</div>{reg.account_journals?.name ?? "—"}</div>
          <div><div className="o-section-title">Último fecho</div>{fmtMoney(lastClosed)}</div>
        </Card>

        <Card>
          <div className="px-4 py-3 border-b font-semibold">Sessões</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2">Nº</th>
                <th className="text-left px-3 py-2">Aberta</th>
                <th className="text-left px-3 py-2">Fechada</th>
                <th className="text-right px-3 py-2">Abertura</th>
                <th className="text-right px-3 py-2">Teórico</th>
                <th className="text-right px-3 py-2">Contado</th>
                <th className="text-right px-3 py-2">Diferença</th>
                <th className="text-left px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Sem sessões</td></tr>
              ) : sessions.map((s) => (
                <tr key={s.id} className="border-t hover:bg-muted/40 cursor-pointer" onClick={() => nav(`/finance/cash/sessions/${s.id}`)}>
                  <td className="px-3 py-2 font-mono">{s.name}</td>
                  <td className="px-3 py-2">{new Date(s.opened_at).toLocaleString("pt-PT")}</td>
                  <td className="px-3 py-2">{s.closed_at ? new Date(s.closed_at).toLocaleString("pt-PT") : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.opening_balance)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.closing_balance_theoretical != null ? fmtMoney(s.closing_balance_theoretical) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.closing_balance_counted != null ? fmtMoney(s.closing_balance_counted) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.difference != null ? fmtMoney(s.difference) : "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${s.state === "open" ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground"}`}>
                      {s.state === "open" ? "Aberta" : "Fechada"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </PageBody>

      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent>
          <DialogHeader><DialogTitle>Abrir sessão de caixa</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Saldo inicial (sugestão = último fecho)</Label>
              <Input type="number" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenDlg(false)}>Cancelar</Button>
            <Button onClick={openNew}>Abrir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
