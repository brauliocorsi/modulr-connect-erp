import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/format";

export default function CashRegistersList() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [journals, setJournals] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", warehouse_id: "", journal_id: "" });

  const load = async () => {
    const { data } = await supabase
      .from("cash_registers")
      .select("*, warehouses(name), account_journals(name), cash_sessions(id, state, opening_balance, closing_balance_counted)")
      .order("name");
    setRows(data ?? []);
  };

  useEffect(() => {
    load();
    (async () => {
      const [{ data: w }, { data: j }] = await Promise.all([
        supabase.from("warehouses").select("id,name").eq("active", true).order("name"),
        supabase.from("account_journals").select("id,name").eq("type", "cash").eq("active", true).order("name"),
      ]);
      setWarehouses(w ?? []);
      setJournals(j ?? []);
    })();
  }, []);

  const create = async () => {
    if (!form.name || !form.warehouse_id) return toast.error("Preencha nome e loja");
    const { error } = await supabase.from("cash_registers").insert({
      name: form.name,
      warehouse_id: form.warehouse_id,
      journal_id: form.journal_id || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Caixa criado");
    setOpen(false);
    setForm({ name: "", warehouse_id: "", journal_id: "" });
    load();
  };

  return (
    <>
      <PageHeader
        title="Caixas"
        breadcrumb={[{ label: "Caixa" }, { label: "Caixas" }]}
        actions={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Novo Caixa</Button>}
      />
      <PageBody>
        {rows.length === 0 ? (
          <EmptyState title="Sem caixas" description="Crie um caixa por loja para controlar movimentos diários." />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map((r) => {
              const openSession = (r.cash_sessions ?? []).find((s: any) => s.state === "open");
              return (
                <Card key={r.id} className="p-4 hover:shadow-md cursor-pointer" onClick={() => nav(`/cashbox/${r.id}`)}>
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="h-4 w-4 text-primary" />
                    <div className="font-semibold">{r.name}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">Loja: {r.warehouses?.name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">Diário: {r.account_journals?.name ?? "—"}</div>
                  <div className="mt-3">
                    {openSession ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-900">
                        Sessão aberta · {fmtMoney(openSession.opening_balance)}
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">Sem sessão</span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Caixa</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div>
              <Label>Loja (Armazém)</Label>
              <Select value={form.warehouse_id} onValueChange={(v) => setForm({ ...form, warehouse_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Diário (cash)</Label>
              <Select value={form.journal_id} onValueChange={(v) => setForm({ ...form, journal_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>{journals.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={create}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
