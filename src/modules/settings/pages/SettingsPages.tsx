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
import { useParams } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

export const UserForm = () => (
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
);

export const UsersSettings = () => (
  <ListView
    title="Usuários"
    breadcrumb={[{ label: "Configurações" }, { label: "Usuários" }]}
    table="profiles"
    searchColumn="full_name"
    rowLink={(r: any) => `/settings/users/${r.id}`}
    actions={<CreateUserDialog />}
    columns={[
      { key: "full_name", header: "Nome" },
      { key: "email", header: "E-mail" },
      { key: "job_title", header: "Cargo" },
      { key: "active", header: "Ativo", render: (r: any) => (r.active ? "Sim" : "Não") },
    ]}
  />
);

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
