import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type SettingDef =
  | { module: string; key: string; label: string; description?: string; type: "boolean"; default: boolean }
  | { module: string; key: string; label: string; description?: string; type: "enum"; options: { value: string; label: string }[]; default: string };

export const MODULE_SETTINGS: { module: string; label: string; items: SettingDef[] }[] = [
  {
    module: "inventory",
    label: "Inventário",
    items: [
      {
        module: "inventory",
        key: "costing_method",
        label: "Método de custeio",
        description: "Como calcular o custo efetivo do produto para relatórios e margens.",
        type: "enum",
        options: [
          { value: "last_cost", label: "Último custo (last_cost)" },
          { value: "average_cost", label: "Custo médio móvel (average_cost)" },
        ],
        default: "last_cost",
      },
    ],
  },
  {
    module: "packaging",
    label: "Embalagens (Packaging)",
    items: [
      {
        module: "packaging",
        key: "tracking_enabled",
        label: "Rastreio de embalagens obrigatório",
        description: "Quando ativo, a preparação para entrega exige stock_packages.",
        type: "boolean",
        default: false,
      },
      {
        module: "packaging",
        key: "auto_create_from_quant",
        label: "Criar embalagens automaticamente a partir de quants",
        description: "Fluxos controlados podem materializar packages sem intervenção manual.",
        type: "boolean",
        default: false,
      },
    ],
  },
];

// Chaves legacy sem namespace 'modulo.' — mapeamento para retrocompatibilidade.
const LEGACY_KEY_MAP: Record<string, string> = {
  "packaging.tracking_enabled": "package_tracking_enabled",
  "packaging.auto_create_from_quant": "package_auto_create_from_quant",
};

function useIsAdmin() {
  return useQuery({
    queryKey: ["is-system-admin"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data } = await supabase.rpc("has_group", { _uid: u.user.id, _code: "system_admin" });
      return !!data;
    },
  });
}

function useSettings() {
  return useQuery({
    queryKey: ["app_settings_all"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("key,value");
      const map = new Map<string, any>();
      (data ?? []).forEach((r: any) => map.set(r.key, r.value));
      return map;
    },
  });
}

function getEffective(map: Map<string, any> | undefined, def: SettingDef) {
  if (!map) return def.default;
  const namespacedKey = `${def.module}.${def.key}`;
  const legacy = LEGACY_KEY_MAP[namespacedKey];
  const v = map.get(namespacedKey) ?? (legacy ? map.get(legacy) : undefined);
  if (v === undefined || v === null) return def.default;
  return v;
}

export default function ModuleSettingsPage() {
  const qc = useQueryClient();
  const { data: isAdmin, isLoading: adminLoading } = useIsAdmin();
  const { data: settings } = useSettings();

  const update = useMutation({
    mutationFn: async ({ def, value }: { def: SettingDef; value: any }) => {
      const { error } = await supabase.rpc("set_module_setting", {
        _module: def.module,
        _key: def.key,
        _value: value as any,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app_settings_all"] });
      toast.success("Configuração guardada");
    },
    onError: (e: any) => {
      if (String(e.message || "").includes("permission_denied")) {
        toast.error("Sem permissão — apenas Administrador do Sistema pode alterar");
      } else {
        toast.error(e.message ?? "Erro ao guardar");
      }
    },
  });

  const disabled = !isAdmin && !adminLoading;

  return (
    <>
      <PageHeader
        title="Configurações por Módulo"
        breadcrumb={[{ label: "Configurações" }, { label: "Módulos" }]}
      />
      <PageBody>
        {disabled && (
          <Card className="p-3 mb-4 border-amber-300 bg-amber-50 text-amber-900 text-sm">
            Modo leitura — apenas Administrador do Sistema pode alterar estas definições.
          </Card>
        )}
        <div className="space-y-6">
          {MODULE_SETTINGS.map((group) => (
            <Card key={group.module} className="p-4">
              <div className="font-semibold mb-3">{group.label}</div>
              <div className="space-y-4">
                {group.items.map((def) => {
                  const current = getEffective(settings, def);
                  const key = `${def.module}.${def.key}`;
                  if (def.type === "boolean") {
                    return (
                      <div key={key} className="flex items-start justify-between gap-4">
                        <div className="space-y-0.5">
                          <Label>{def.label}</Label>
                          {def.description && (
                            <div className="text-xs text-muted-foreground">{def.description}</div>
                          )}
                          <div className="text-[10px] font-mono text-muted-foreground">{key}</div>
                        </div>
                        <Switch
                          checked={!!current}
                          disabled={disabled || update.isPending}
                          onCheckedChange={(v) => update.mutate({ def, value: v as any })}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={key} className="flex items-start justify-between gap-4">
                      <div className="space-y-0.5">
                        <Label>{def.label}</Label>
                        {def.description && (
                          <div className="text-xs text-muted-foreground">{def.description}</div>
                        )}
                        <div className="text-[10px] font-mono text-muted-foreground">{key}</div>
                      </div>
                      <Select
                        value={String(current)}
                        disabled={disabled || update.isPending}
                        onValueChange={(v) => update.mutate({ def, value: v })}
                      >
                        <SelectTrigger className="w-64">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {def.options.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}
