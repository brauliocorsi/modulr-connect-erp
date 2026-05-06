import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";
import { toast } from "sonner";

const MODULES = ["core", "products", "sales", "purchase", "inventory"] as const;
const ACTIONS = ["view", "create", "edit", "delete", "export"] as const;
const ENTITIES: Record<string, string[]> = {
  core: ["partners", "companies"],
  products: ["products", "categories", "attributes", "uom", "bom"],
  sales: ["orders", "pricelists"],
  purchase: ["orders"],
  inventory: ["transfers", "locations", "adjustments", "rules"],
};

export default function GroupForm() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const [group, setGroup] = useState<any>({ code: "", name: "", module: "core", description: "" });
  const [perms, setPerms] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const { data: g } = await supabase.from("groups").select("*").eq("id", id!).maybeSingle();
      if (g) setGroup(g);
      const { data: gp } = await supabase.from("group_permissions").select("*").eq("group_id", id!);
      setPerms(new Set((gp ?? []).map((p: any) => `${p.module}:${p.entity}:${p.action}`)));
    })();
  }, [id, isNew]);

  const togglePerm = (key: string, on: boolean) => {
    setPerms((p) => { const n = new Set(p); on ? n.add(key) : n.delete(key); return n; });
  };

  const save = async () => {
    if (!group.code || !group.name) return toast.error("Código e nome obrigatórios");
    let gid = id as string | undefined;
    const payload = { code: group.code, name: group.name, module: group.module, description: group.description };
    if (isNew) {
      const { data, error } = await supabase.from("groups").insert(payload as any).select("id").single();
      if (error) return toast.error(error.message);
      gid = (data as any).id;
    } else {
      const { error } = await supabase.from("groups").update(payload as any).eq("id", gid!);
      if (error) return toast.error(error.message);
    }
    // replace permissions
    await supabase.from("group_permissions").delete().eq("group_id", gid!);
    const inserts = Array.from(perms).map((k) => {
      const [module, entity, action] = k.split(":");
      return { group_id: gid, module, entity, action } as any;
    });
    if (inserts.length) {
      const { error } = await supabase.from("group_permissions").insert(inserts);
      if (error) return toast.error(error.message);
    }
    toast.success("Salvo");
  };

  const rows = useMemo(() =>
    MODULES.flatMap((m) => ENTITIES[m].map((e) => ({ module: m, entity: e })))
  , []);

  return (
    <>
      <FormHeader
        title={isNew ? "Novo Grupo" : group.name}
        breadcrumb={[{ label: "Configurações" }, { label: "Grupos", to: "/settings/groups" }, { label: group.name || "Novo" }]}
        backTo="/settings/groups"
        actions={<Button size="sm" onClick={save}><Save className="h-4 w-4 mr-1" /> Salvar</Button>}
      />
      <PageBody>
        <div className="space-y-4">
          <Card className="p-6 grid sm:grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Código *</Label><Input value={group.code} onChange={(e) => setGroup({ ...group, code: e.target.value })} /></div>
            <div className="space-y-2"><Label>Nome *</Label><Input value={group.name} onChange={(e) => setGroup({ ...group, name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Módulo</Label><Input value={group.module} onChange={(e) => setGroup({ ...group, module: e.target.value })} /></div>
            <div className="space-y-2 sm:col-span-3"><Label>Descrição</Label><Input value={group.description ?? ""} onChange={(e) => setGroup({ ...group, description: e.target.value })} /></div>
          </Card>
          <Card>
            <div className="px-4 py-3 border-b font-semibold">Permissões</div>
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2">Módulo</th>
                  <th className="text-left px-3 py-2">Entidade</th>
                  {ACTIONS.map((a) => <th key={a} className="text-center px-3 py-2 capitalize">{a}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.module}-${r.entity}`} className="border-t">
                    <td className="px-3 py-2">{r.module}</td>
                    <td className="px-3 py-2">{r.entity}</td>
                    {ACTIONS.map((a) => {
                      const k = `${r.module}:${r.entity}:${a}`;
                      return (
                        <td key={a} className="text-center px-3 py-2">
                          <Checkbox checked={perms.has(k)} onCheckedChange={(v) => togglePerm(k, !!v)} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
