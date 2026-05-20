import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { MODULES } from "@/core/modules/registry";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ListView } from "@/core/layout/ListView";
import { SimpleForm } from "@/core/layout/SimpleForm";
import { toast } from "sonner";
import { Plus, Link2, Unlink } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { EntityHeader } from "@/core/operational/EntityHeader";
import { OperationalDataTable } from "@/core/operational/OperationalDataTable";
import { OperationalStatusBadge } from "@/core/operational/OperationalStatusBadge";
import { UserStoreAssignmentsPanel } from "@/modules/settings/components/UserStoreAssignmentsPanel";
import { UserRolesPanel } from "@/modules/settings/components/UserRolesPanel";
import { PermissionsHealthCard } from "@/modules/settings/components/PermissionsHealthCard";

export const AppsSettings = () => {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["installed_modules"],
    queryFn: async () => {
      const { data } = await supabase.from("installed_modules").select("*");
      return data ?? [];
    },
  });
  const toggle = useMutation({
    mutationFn: async ({ module, installed }: { module: string; installed: boolean }) => {
      const { error } = await supabase
        .from("installed_modules")
        .upsert({ module: module as any, installed, installed_at: new Date().toISOString() }, { onConflict: "module" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["installed_modules"] });
      toast.success("Atualizado");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader title="Apps" breadcrumb={[{ label: "Configurações" }, { label: "Apps" }]} />
      <PageBody>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.filter((m) => m.id !== "settings").map((m) => {
            const row = Array.isArray(data) ? data.find((d: any) => d.module === m.id) : undefined;
            const installed = row?.installed ?? false;
            return (
              <Card key={m.id} className="p-4 flex items-start gap-4">
                <div className={"h-12 w-12 rounded-lg grid place-items-center text-white shrink-0 " + m.color}>
                  <m.icon className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{m.name}</div>
                    <Switch
                      checked={installed}
                      onCheckedChange={(v) => toggle.mutate({ module: m.id as string, installed: v })}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{m.description}</div>
                </div>
              </Card>
            );
          })}
        </div>
      </PageBody>
    </>
  );
};

function CreateUserDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const { data: groups } = useQuery({
    queryKey: ["groups-for-user-create"],
    queryFn: async () => {
      const { data } = await supabase.from("groups").select("code, name, module").order("module").order("name");
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email,
          password,
          full_name: fullName || email,
          job_title: jobTitle || null,
          group_codes: selected,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      toast.success("Utilizador criado");
      qc.invalidateQueries({ queryKey: ["profiles"] });
      setOpen(false);
      setEmail(""); setPassword(""); setFullName(""); setJobTitle(""); setSelected([]);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao criar utilizador"),
  });

  const toggle = (code: string) =>
    setSelected((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Novo utilizador</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Novo utilizador</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>E-mail *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><Label>Password *</Label><Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
            <div><Label>Nome completo</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
            <div><Label>Cargo</Label><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></div>
          </div>
          <div>
            <Label>Grupos</Label>
            <div className="mt-2 max-h-64 overflow-auto border rounded-md p-2 space-y-1">
              {(groups ?? []).map((g: any) => (
                <label key={g.code} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                  <Checkbox checked={selected.includes(g.code)} onCheckedChange={() => toggle(g.code)} />
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-muted-foreground">({g.module})</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Se não selecionar nenhum, serão atribuídos os grupos padrão.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => create.mutate()} disabled={!email || !password || create.isPending}>
            {create.isPending ? "A criar…" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeLinkCard() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string>("");

  const { data: linked } = useQuery({
    queryKey: ["hr_employee_for_user", id],
    enabled: !!id && id !== "new",
    queryFn: async () => {
      const { data } = await supabase.from("hr_employees").select("id, full_name, job_title, email").eq("user_id", id!).maybeSingle();
      return data;
    },
  });

  const { data: available } = useQuery({
    queryKey: ["hr_employees_unlinked"],
    queryFn: async () => {
      const { data } = await supabase.from("hr_employees").select("id, full_name, email").is("user_id", null).eq("active", true).order("full_name");
      return data ?? [];
    },
  });

  const link = useMutation({
    mutationFn: async (employeeId: string) => {
      const { error } = await supabase.from("hr_employees").update({ user_id: id! }).eq("id", employeeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Funcionário vinculado");
      setSelected("");
      qc.invalidateQueries({ queryKey: ["hr_employee_for_user", id] });
      qc.invalidateQueries({ queryKey: ["hr_employees_unlinked"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const unlink = useMutation({
    mutationFn: async () => {
      if (!linked?.id) return;
      const { error } = await supabase.from("hr_employees").update({ user_id: null }).eq("id", linked.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Vínculo removido");
      qc.invalidateQueries({ queryKey: ["hr_employee_for_user", id] });
      qc.invalidateQueries({ queryKey: ["hr_employees_unlinked"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!id || id === "new") return null;

  return (
    <PageBody>
      <Card className="p-6 max-w-3xl space-y-4">
        <div>
          <div className="font-semibold">Funcionário vinculado</div>
          <div className="text-xs text-muted-foreground">Associe este utilizador a uma ficha de funcionário existente.</div>
        </div>
        {linked ? (
          <div className="flex items-center justify-between gap-3 border rounded-md p-3">
            <div>
              <div className="font-medium">{linked.full_name}</div>
              <div className="text-xs text-muted-foreground">{linked.job_title || linked.email}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => unlink.mutate()} disabled={unlink.isPending}>
              <Unlink className="h-4 w-4 mr-1" /> Desvincular
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-2">
              <Label>Funcionário</Label>
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger><SelectValue placeholder="Selecione um funcionário…" /></SelectTrigger>
                <SelectContent>
                  {(available ?? []).map((e: any) => (
                    <SelectItem key={e.id} value={e.id}>{e.full_name}{e.email ? ` — ${e.email}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={() => selected && link.mutate(selected)} disabled={!selected || link.isPending}>
              <Link2 className="h-4 w-4 mr-1" /> Vincular
            </Button>
          </div>
        )}
      </Card>
    </PageBody>
  );
}

export const UserForm = () => {
  const { id } = useParams();
  return (
    <>
      <SimpleForm
        table="profiles"
        title="Usuário"
        basePath="/settings/users"
        breadcrumb={[{ label: "Configurações" }, { label: "Usuários", to: "/settings/users" }, { label: "Editar" }]}
        fields={[
          { name: "full_name", label: "Nome completo" },
          { name: "job_title", label: "Cargo" },
          { name: "active", label: "Ativo", type: "boolean", default: true },
        ]}
      />
      <EmployeeLinkCard />
      {id && id !== "new" && (
        <PageBody>
          <div className="space-y-4">
            <UserStoreAssignmentsPanel userId={id} />
            <UserRolesPanel userId={id} />
          </div>
        </PageBody>
      )}
    </>
  );
};

export const UsersSettings = () => {
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["settings-users", search],
    queryFn: async () => {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email, job_title, active")
        .order("full_name", { ascending: true });
      const ids = (profs ?? []).map((p: any) => p.id);
      const [{ data: ug }, { data: us }] = await Promise.all([
        ids.length
          ? supabase.from("user_groups").select("user_id, groups(code, name)").in("user_id", ids)
          : Promise.resolve({ data: [] as any[] }),
        ids.length
          ? supabase
              .from("user_store_assignments")
              .select("user_id, is_default, active, stores(name)")
              .in("user_id", ids)
              .eq("active", true)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const groupsBy = new Map<string, any[]>();
      (ug ?? []).forEach((r: any) => {
        const arr = groupsBy.get(r.user_id) ?? [];
        arr.push(r.groups);
        groupsBy.set(r.user_id, arr);
      });
      const storesBy = new Map<string, any[]>();
      (us ?? []).forEach((r: any) => {
        const arr = storesBy.get(r.user_id) ?? [];
        arr.push(r);
        storesBy.set(r.user_id, arr);
      });
      return (profs ?? [])
        .filter((p: any) =>
          search
            ? (p.full_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
              (p.email ?? "").toLowerCase().includes(search.toLowerCase())
            : true,
        )
        .map((p: any) => ({
          ...p,
          groups: groupsBy.get(p.id) ?? [],
          stores: storesBy.get(p.id) ?? [],
        }));
    },
  });

  return (
    <>
      <EntityHeader
        title="Utilizadores"
        breadcrumb={[{ label: "Configurações" }, { label: "Utilizadores" }]}
        onRefresh={() => { void refetch(); void qc.invalidateQueries({ queryKey: ["settings-users"] }); }}
        isFetching={isFetching}
      />
      <PageBody>
        <div className="mb-3 flex justify-end"><CreateUserDialog /></div>
        <OperationalDataTable
          rows={data ?? []}
          getRowId={(r: any) => r.id}
          isLoading={isLoading}
          isFetching={isFetching}
          search={{ value: search, onChange: setSearch, placeholder: "Pesquisar nome ou e-mail…" }}
          onRowClick={(r: any) => navigate(`/settings/users/${r.id}`)}
          emptyTitle="Sem utilizadores"
          columns={[
            { key: "full_name", header: "Nome", cell: (r: any) => r.full_name || "—" },
            { key: "email", header: "E-mail", cell: (r: any) => r.email || "—" },
            {
              key: "active",
              header: "Estado",
              cell: (r: any) => (
                <OperationalStatusBadge label={r.active ? "Ativo" : "Inativo"} tone={r.active ? "success" : "muted"} />
              ),
            },
            {
              key: "groups",
              header: "Grupos",
              cell: (r: any) => (
                <div className="flex flex-wrap gap-1">
                  {r.groups.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                  {r.groups.slice(0, 3).map((g: any, i: number) => (
                    <Badge key={i} variant="outline" className="text-[10px]">{g?.name ?? g?.code}</Badge>
                  ))}
                  {r.groups.length > 3 && <span className="text-xs text-muted-foreground">+{r.groups.length - 3}</span>}
                </div>
              ),
            },
            {
              key: "stores",
              header: "Lojas",
              cell: (r: any) => (
                <div className="flex flex-wrap gap-1">
                  {r.stores.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                  {r.stores.map((s: any, i: number) => (
                    <Badge key={i} variant={s.is_default ? "default" : "secondary"} className="text-[10px]">
                      {s.stores?.name ?? "?"}{s.is_default ? " ★" : ""}
                    </Badge>
                  ))}
                </div>
              ),
            },
          ]}
        />
        <div className="mt-6">
          <PermissionsHealthCard />
        </div>
      </PageBody>
    </>
  );
};

export const GroupsSettings = () => (
  <ListView
    title="Grupos & Permissões"
    breadcrumb={[{ label: "Configurações" }, { label: "Grupos" }]}
    table="groups"
    searchColumn="name"
    createTo="/settings/groups/new"
    rowLink={(r: any) => `/settings/groups/${r.id}`}
    columns={[
      { key: "code", header: "Código" },
      { key: "name", header: "Nome" },
      { key: "module", header: "Módulo" },
      { key: "description", header: "Descrição" },
    ]}
  />
);


export const CompanySettings = () => (
  <ListView
    title="Empresa"
    breadcrumb={[{ label: "Configurações" }, { label: "Empresa" }]}
    table="companies"
    searchColumn="name"
    columns={[
      { key: "name", header: "Nome" },
      { key: "currency", header: "Moeda" },
    ]}
  />
);
