import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2 } from "lucide-react";

const LABEL: Record<string, string> = {
  user_with_cash_permission_without_store: "Utilizador com caixa mas sem loja",
  user_with_multiple_default_stores: "Utilizador com várias lojas default",
  cash_register_without_store: "Caixa sem loja",
  open_cash_session_register_without_store: "Sessão de caixa aberta sem loja",
  user_store_assignment_inactive_but_open_session: "Assignment inativo com sessão aberta",
  cashier_without_cash_permission: "Cashier sem permissão de caixa",
};

export function PermissionsHealthCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["permissions-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("permissions_health_check" as any);
      if (error) throw error;
      return (data ?? []) as Array<{ code: string; severity: string; entity_id: string; detail: string | null }>;
    },
  });

  return (
    <Card className="p-6 max-w-3xl space-y-3" data-testid="permissions-health">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">Saúde de permissões</div>
          <div className="text-xs text-muted-foreground">Apenas leitura. Não auto-corrige.</div>
        </div>
        {!isLoading && (data?.length ?? 0) === 0 && (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> Tudo OK
          </Badge>
        )}
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">A verificar…</div>
      ) : (data ?? []).length === 0 ? (
        <div className="text-sm text-muted-foreground">Nenhum problema detectado.</div>
      ) : (
        <ul className="space-y-1 text-sm">
          {(data ?? []).map((f, i) => (
            <li key={i} className="flex items-center gap-2 border rounded-md px-2 py-1">
              <AlertCircle className={f.severity === "P0" ? "h-4 w-4 text-rose-600" : "h-4 w-4 text-amber-500"} />
              <Badge variant={f.severity === "P0" ? "destructive" : "secondary"}>{f.severity}</Badge>
              <span className="font-medium">{LABEL[f.code] ?? f.code}</span>
              {f.detail && <span className="text-xs text-muted-foreground">— {f.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
