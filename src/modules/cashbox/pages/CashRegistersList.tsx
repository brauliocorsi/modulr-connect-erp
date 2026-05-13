import { useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Wallet, Truck, Store, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney } from "@/lib/format";

type Kind = "store" | "driver";

export default function CashRegistersList() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("store");
  const [stores, setStores] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [journals, setJournals] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: "",
    store_id: "",
    warehouse_id: "",
    journal_id: "",
    user_id: "",
    department_id: "",
    driver_employee_id: "",
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkMode, setLinkMode] = useState<"existing" | "new">("existing");
  const [linkForm, setLinkForm] = useState({ email: "", password: "", existing_user_id: "" });
  const [availableProfiles, setAvailableProfiles] = useState<any[]>([]);
  const [linking, setLinking] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("cash_registers")
      .select("*, store:stores(name), warehouses(name), account_journals(name), cash_sessions(id, state, opening_balance, closing_balance_counted)")
      .order("name");
    const userIds = Array.from(new Set((data ?? []).flatMap((r: any) => [r.user_id, r.driver_id]).filter(Boolean)));
    const deptIds = Array.from(new Set((data ?? []).map((r: any) => r.department_id).filter(Boolean)));
    let userMap: Record<string, string> = {};
    let deptMap: Record<string, string> = {};
    if (userIds.length) {
      const { data: emp } = await supabase.from("hr_employees").select("user_id, full_name").in("user_id", userIds);
      userMap = Object.fromEntries((emp ?? []).map((e: any) => [e.user_id, e.full_name]));
    }
    if (deptIds.length) {
      const { data: d } = await supabase.from("hr_departments").select("id,name").in("id", deptIds);
      deptMap = Object.fromEntries((d ?? []).map((e: any) => [e.id, e.name]));
    }
    setRows((data ?? []).map((r: any) => ({
      ...r,
      user_name: r.user_id ? userMap[r.user_id] : null,
      driver_name: r.driver_id ? userMap[r.driver_id] : null,
      department_name: r.department_id ? deptMap[r.department_id] : null,
    })));
  };

  useEffect(() => {
    load();
    (async () => {
      const [{ data: s }, { data: w }, { data: j }, { data: e }, { data: d }] = await Promise.all([
        supabase.from("stores").select("id,name,warehouse_id").eq("active", true).order("name"),
        supabase.from("warehouses").select("id,name").eq("active", true).order("name"),
        supabase.from("account_journals").select("id,name").eq("type", "cash").eq("active", true).order("name"),
        supabase.from("hr_employees").select("id, user_id, full_name, department_id").eq("active", true).order("full_name"),
        supabase.from("hr_departments").select("id,name").order("name"),
      ]);
      setStores(s ?? []);
      setWarehouses(w ?? []);
      setJournals(j ?? []);
      setUsers(e ?? []);
      setDepartments(d ?? []);
      if ((w ?? []).length === 1) setForm((f) => ({ ...f, warehouse_id: f.warehouse_id || w![0].id }));
      if ((s ?? []).length === 1) {
        setForm((f) => ({
          ...f,
          store_id: f.store_id || s![0].id,
          warehouse_id: f.warehouse_id || s![0].warehouse_id || ((w ?? []).length === 1 ? w![0].id : ""),
        }));
      }
      if ((j ?? []).length === 1) setForm((f) => ({ ...f, journal_id: f.journal_id || j![0].id }));
    })();
  }, []);

  useEffect(() => {
    if (open && user?.id && !form.user_id && kind === "store") {
      setForm((f) => ({ ...f, user_id: user.id }));
    }
  }, [open, user?.id, kind]);

  const driverEmployees = useMemo(() => {
    if (!form.department_id) return users;
    return users.filter((u) => u.department_id === form.department_id);
  }, [users, form.department_id]);

  const onStoreChange = (v: string) => {
    const st = stores.find((s) => s.id === v);
    const fallback = warehouses.length === 1 ? warehouses[0].id : "";
    setForm((f) => ({ ...f, store_id: v, warehouse_id: st?.warehouse_id ?? f.warehouse_id ?? fallback }));
  };

  const onDriverChange = (employeeId: string) => {
    const emp = users.find((u) => u.id === employeeId);
    setForm((f) => ({
      ...f,
      driver_employee_id: employeeId,
      name: f.name || (emp ? `Caixa ${emp.full_name}` : ""),
    }));
  };

  const selectedDriver = useMemo(() => users.find((u) => u.id === form.driver_employee_id), [users, form.driver_employee_id]);

  const openLinkDialog = async () => {
    setLinkOpen(true);
    setLinkMode("existing");
    setLinkForm({ email: "", password: "", existing_user_id: "" });
    // Carrega perfis que ainda não estão associados a um funcionário
    const linkedIds = users.map((u) => u.user_id).filter(Boolean);
    let q = supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name");
    if (linkedIds.length) q = q.not("id", "in", `(${linkedIds.join(",")})`);
    const { data } = await q;
    setAvailableProfiles(data ?? []);
  };

  const linkUser = async () => {
    if (!selectedDriver) return;
    setLinking(true);
    try {
      let newUserId: string;
      if (linkMode === "existing") {
        if (!linkForm.existing_user_id) {
          setLinking(false);
          return toast.error("Selecione um utilizador");
        }
        newUserId = linkForm.existing_user_id;
      } else {
        if (!linkForm.email.trim() || !linkForm.password.trim()) {
          setLinking(false);
          return toast.error("Preencha email e password");
        }
        const { data: session } = await supabase.auth.getSession();
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.session?.access_token ?? ""}`,
          },
          body: JSON.stringify({
            email: linkForm.email.trim(),
            password: linkForm.password,
            full_name: selectedDriver.full_name,
          }),
        });
        const result = await res.json();
        if (!res.ok || result.error) throw new Error(result.error || "Erro ao criar utilizador");
        newUserId = result.user_id;
      }
      const { error: updErr } = await supabase.from("hr_employees").update({ user_id: newUserId }).eq("id", selectedDriver.id);
      if (updErr) throw updErr;
      setUsers((prev) => prev.map((u) => (u.id === selectedDriver.id ? { ...u, user_id: newUserId } : u)));
      setForm((f) => ({ ...f, driver_employee_id: selectedDriver.id }));
      setLinkOpen(false);
      setLinkForm({ email: "", password: "", existing_user_id: "" });
      toast.success("Utilizador associado ao funcionário");
    } catch (e: any) {
      toast.error(e.message || "Erro ao associar utilizador");
    } finally {
      setLinking(false);
    }
  };

  const create = async () => {
    if (!form.name.trim()) return toast.error("Indique o nome do caixa");

    if (kind === "store") {
      if (!form.store_id) return toast.error("Selecione a loja");
    } else {
      if (!form.driver_employee_id) return toast.error("Selecione o entregador responsável");
      const emp = users.find((u) => u.id === form.driver_employee_id);
      if (!emp?.user_id) return toast.error("Este funcionário ainda não tem utilizador associado. Crie/associe um utilizador na ficha do funcionário antes de criar o caixa de entregador.");
    }

    // Para entregador, criamos sempre um diário próprio (ignora seleção).
    let journalId = kind === "driver" ? "" : form.journal_id;
    if (!journalId) {
      const prefix = kind === "driver" ? "CASH-DRV" : "CASH";
      const slug = form.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 20);
      const suffix = Date.now().toString(36).slice(-4).toUpperCase();
      const code = `${prefix}-${slug}-${suffix}`;
      const { data: j, error: jErr } = await supabase
        .from("account_journals")
        .insert({ name: `Caixa ${form.name.trim()}`, code, type: "cash", currency: "EUR", active: true })
        .select("id")
        .single();
      if (jErr) return toast.error("Erro ao criar diário: " + jErr.message);
      journalId = j.id;
    }

    let payload: any = {
      name: form.name.trim(),
      journal_id: journalId,
    };

    if (kind === "store") {
      let warehouseId = form.warehouse_id;
      if (!warehouseId) {
        const st = stores.find((s) => s.id === form.store_id);
        warehouseId = st?.warehouse_id || (warehouses[0]?.id ?? null);
      }
      payload = {
        ...payload,
        store_id: form.store_id,
        warehouse_id: warehouseId || null,
        user_id: form.user_id || user?.id || null,
      };
    } else {
      const emp = users.find((u) => u.id === form.driver_employee_id);
      payload = {
        ...payload,
        store_id: null,
        warehouse_id: null,
        department_id: form.department_id || null,
        driver_id: emp?.user_id ?? null,
        user_id: emp?.user_id ?? null,
      };
    }

    const { error } = await supabase.from("cash_registers").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Caixa criado");
    setOpen(false);
    setKind("store");
    setForm({ name: "", store_id: "", warehouse_id: "", journal_id: "", user_id: "", department_id: "", driver_employee_id: "" });
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
          <EmptyState title="Sem caixas" description="Crie um caixa por loja ou por entregador para controlar movimentos diários." />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map((r) => {
              const openSession = (r.cash_sessions ?? []).find((s: any) => s.state === "open");
              const isDriver = !!r.driver_id;
              return (
                <Card key={r.id} className="p-4 hover:shadow-md cursor-pointer" onClick={() => nav(`/cashbox/${r.id}`)}>
                  <div className="flex items-center gap-2 mb-2">
                    {isDriver ? <Truck className="h-4 w-4 text-primary" /> : <Wallet className="h-4 w-4 text-primary" />}
                    <div className="font-semibold">{r.name}</div>
                    <span className={`ml-auto inline-flex px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider ${isDriver ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>
                      {isDriver ? "Entregador" : "Loja"}
                    </span>
                  </div>
                  {isDriver ? (
                    <>
                      <div className="text-xs text-muted-foreground">Entregador: {r.driver_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">Departamento: {r.department_name ?? "—"}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs text-muted-foreground">Loja: {r.store?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">Armazém: {r.warehouses?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">Responsável: {r.user_name ?? "—"}</div>
                    </>
                  )}
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
            <p className="text-xs text-muted-foreground mt-1">Escolha o tipo de caixa. Os campos opcionais têm valores por defeito.</p>
          </DialogHeader>

          <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)} className="w-full">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="store"><Store className="h-4 w-4 mr-1" /> Loja</TabsTrigger>
              <TabsTrigger value="driver"><Truck className="h-4 w-4 mr-1" /> Entregador</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid gap-3">
            <div>
              <Label>Nome <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={kind === "driver" ? "Ex.: Caixa João Entregador" : "Ex.: Caixa Loja Centro"} />
            </div>

            {kind === "store" ? (
              <>
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
              </>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Departamento</Label>
                    <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v, driver_employee_id: "" })}>
                      <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                      <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Entregador responsável <span className="text-destructive">*</span></Label>
                    <Select value={form.driver_employee_id} onValueChange={onDriverChange}>
                      <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                      <SelectContent>
                        {driverEmployees.length === 0 ? (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">Sem funcionários no departamento</div>
                        ) : driverEmployees.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.full_name}{!u.user_id ? " — sem utilizador" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {selectedDriver && !selectedDriver.user_id && (
                  <Alert variant="destructive" className="py-2">
                    <AlertDescription className="flex items-center justify-between gap-2">
                      <span className="text-xs">Este funcionário não tem utilizador associado.</span>
                      <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
                        <UserPlus className="h-3.5 w-3.5 mr-1" /> Associar utilizador
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Será criado automaticamente um diário de caixa dedicado ao entregador, pronto para abertura e fecho de sessão.
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={create}>Criar Caixa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Associar utilizador a {selectedDriver?.full_name ?? "funcionário"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input
                type="email"
                value={linkForm.email}
                onChange={(e) => setLinkForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="exemplo@email.com"
              />
            </div>
            <div>
              <Label>Password <span className="text-destructive">*</span></Label>
              <Input
                type="password"
                value={linkForm.password}
                onChange={(e) => setLinkForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkOpen(false)}>Cancelar</Button>
            <Button onClick={linkUser} disabled={linking}>{linking ? "A associar…" : "Criar e associar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
