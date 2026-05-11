import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
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
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [stores, setStores] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [journals, setJournals] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", store_id: "", warehouse_id: "", journal_id: "", user_id: "" });

  const load = async () => {
    const { data } = await supabase
      .from("cash_registers")
      .select("*, store:stores(name), warehouses(name), account_journals(name), cash_sessions(id, state, opening_balance, closing_balance_counted)")
      .order("name");
    const userIds = Array.from(new Set((data ?? []).map((r: any) => r.user_id).filter(Boolean)));
    let userMap: Record<string, string> = {};
    if (userIds.length) {
      const { data: emp } = await supabase.from("hr_employees").select("user_id, full_name").in("user_id", userIds);
      userMap = Object.fromEntries((emp ?? []).map((e: any) => [e.user_id, e.full_name]));
    }
    setRows((data ?? []).map((r: any) => ({ ...r, user_name: r.user_id ? userMap[r.user_id] : null })));
  };

  useEffect(() => {
    load();
    (async () => {
      const [{ data: s }, { data: w }, { data: j }, { data: e }] = await Promise.all([
        supabase.from("stores").select("id,name,warehouse_id").eq("active", true).order("name"),
        supabase.from("warehouses").select("id,name").eq("active", true).order("name"),
        supabase.from("account_journals").select("id,name").eq("type", "cash").eq("active", true).order("name"),
        supabase.from("hr_employees").select("user_id, full_name").eq("active", true).not("user_id", "is", null).order("full_name"),
      ]);
      setStores(s ?? []);
      setWarehouses(w ?? []);
      setJournals(j ?? []);
      setUsers(e ?? []);
      // Se só existe 1 armazém, pré-selecciona
      if ((w ?? []).length === 1) {
        setForm((f) => ({ ...f, warehouse_id: f.warehouse_id || w![0].id }));
      }
      // Se só existe 1 loja, pré-selecciona (e herda armazém)
      if ((s ?? []).length === 1) {
        setForm((f) => ({
          ...f,
          store_id: f.store_id || s![0].id,
          warehouse_id: f.warehouse_id || s![0].warehouse_id || ((w ?? []).length === 1 ? w![0].id : ""),
        }));
      }
      // Se só existe 1 diário cash, pré-selecciona
      if ((j ?? []).length === 1) {
        setForm((f) => ({ ...f, journal_id: f.journal_id || j![0].id }));
      }
    })();
  }, []);

  // Default responsável = utilizador autenticado
  useEffect(() => {
    if (open && user?.id && !form.user_id) {
      setForm((f) => ({ ...f, user_id: user.id }));
    }
  }, [open, user?.id]);

  // Ao escolher loja, herda armazém da loja se existir
  const onStoreChange = (v: string) => {
    const st = stores.find((s) => s.id === v);
    const fallback = warehouses.length === 1 ? warehouses[0].id : "";
    setForm((f) => ({ ...f, store_id: v, warehouse_id: st?.warehouse_id ?? f.warehouse_id ?? fallback }));
  };

  const create = async () => {
    if (!form.name.trim()) return toast.error("Indique o nome do caixa");
    if (!form.store_id) return toast.error("Selecione a loja");

    let journalId = form.journal_id;
    // Cria diário automaticamente se não foi escolhido
    if (!journalId) {
      const code = `CASH-${form.name.trim().toUpperCase().replace(/\s+/g, "-").slice(0, 20)}`;
      const { data: j, error: jErr } = await supabase
        .from("account_journals")
        .insert({ name: `Caixa ${form.name.trim()}`, code, type: "cash", currency: "EUR", active: true })
        .select("id")
        .single();
      if (jErr) return toast.error("Erro ao criar diário: " + jErr.message);
      journalId = j.id;
    }

    // Armazém: herda da loja se vazio
    let warehouseId = form.warehouse_id;
    if (!warehouseId) {
      const st = stores.find((s) => s.id === form.store_id);
      warehouseId = st?.warehouse_id || (warehouses[0]?.id ?? null);
    }

    const { error } = await supabase.from("cash_registers").insert({
      name: form.name.trim(),
      store_id: form.store_id,
      warehouse_id: warehouseId || null,
      journal_id: journalId,
      user_id: form.user_id || user?.id || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Caixa criado");
    setOpen(false);
    setForm({ name: "", store_id: "", warehouse_id: "", journal_id: "", user_id: "" });
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
                  <div className="text-xs text-muted-foreground">Loja: {r.store?.name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">Armazém: {r.warehouses?.name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">Responsável: {r.user_name ?? "—"}</div>
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
          <DialogHeader>
            <DialogTitle>Novo Caixa</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">Apenas o nome e a loja são obrigatórios. Os restantes campos têm valores por defeito.</p>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Nome <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Caixa Loja Centro" />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Loja <span className="text-destructive">*</span></Label>
                <Select value={form.store_id} onValueChange={onStoreChange}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>{stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Armazém</Label>
                <Select value={form.warehouse_id} onValueChange={(v) => setForm({ ...form, warehouse_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Herda da loja" /></SelectTrigger>
                  <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Responsável</Label>
                <Select value={form.user_id} onValueChange={(v) => setForm({ ...form, user_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Eu próprio" /></SelectTrigger>
                  <SelectContent>{users.map((u) => <SelectItem key={u.user_id} value={u.user_id}>{u.full_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Diário (cash)</Label>
                <Select value={form.journal_id} onValueChange={(v) => setForm({ ...form, journal_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Criar automaticamente" /></SelectTrigger>
                  <SelectContent>{journals.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={create}>Criar Caixa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
