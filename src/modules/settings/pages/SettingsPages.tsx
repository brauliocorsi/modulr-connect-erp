import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { MODULES } from "@/core/modules/registry";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ListView } from "@/core/layout/ListView";
import { toast } from "sonner";

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
      const { error } = await supabase.from("installed_modules").update({ installed }).eq("module", module as any);
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

export const UsersSettings = () => (
  <ListView
    title="Usuários"
    breadcrumb={[{ label: "Configurações" }, { label: "Usuários" }]}
    table="profiles"
    searchColumn="full_name"
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
