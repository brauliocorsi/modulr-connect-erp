import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";
import { useRpcMutation } from "@/core/operational/hooks/useRpcMutation";

export function UserRolesPanel({ userId }: { userId: string }) {
  const [groupCode, setGroupCode] = useState("");
  const invalidate = [["user-roles", userId]];

  const { data: allGroups } = useQuery({
    queryKey: ["groups-all"],
    queryFn: async () => {
      const { data } = await supabase.from("groups").select("code, name, module").order("module").order("name");
      return data ?? [];
    },
  });

  const { data: assigned } = useQuery({
    queryKey: ["user-roles", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_groups")
        .select("group_id, groups(code, name)")
        .eq("user_id", userId);
      return data ?? [];
    },
  });

  const assign = useRpcMutation({
    rpc: "user_role_assign",
    successMessage: "Grupo adicionado",
    invalidateKeys: invalidate,
    onSuccess: () => setGroupCode(""),
  });
  const remove = useRpcMutation({
    rpc: "user_role_remove",
    successMessage: "Grupo removido",
    invalidateKeys: invalidate,
  });

  const assignedCodes = new Set((assigned ?? []).map((a: any) => a.groups?.code));
  const available = (allGroups ?? []).filter((g: any) => !assignedCodes.has(g.code));

  return (
    <Card className="p-6 max-w-3xl space-y-4" data-testid="user-roles-panel">
      <div>
        <div className="font-semibold">Grupos / Funções</div>
        <div className="text-xs text-muted-foreground">Controla acessos a módulos e ações.</div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(assigned ?? []).length === 0 && (
          <span className="text-sm text-muted-foreground italic">Sem grupos atribuídos.</span>
        )}
        {(assigned ?? []).map((a: any) => (
          <Badge key={a.group_id} variant="secondary" className="gap-1">
            {a.groups?.name ?? a.group_id}
            <button
              type="button"
              aria-label="Remover"
              className="ml-1 hover:text-destructive"
              onClick={() =>
                remove.mutate({ _user_id: userId, _group_code: a.groups?.code })
              }
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      <div className="border-t pt-4 grid grid-cols-[1fr_auto] gap-2 items-end">
        <div>
          <Label>Adicionar grupo</Label>
          <Select value={groupCode} onValueChange={setGroupCode}>
            <SelectTrigger><SelectValue placeholder="Selecione grupo…" /></SelectTrigger>
            <SelectContent>
              {available.map((g: any) => (
                <SelectItem key={g.code} value={g.code}>
                  {g.name} <span className="text-xs text-muted-foreground">({g.module})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={!groupCode || assign.isPending}
          onClick={() => assign.mutate({ _user_id: userId, _group_code: groupCode })}
        >
          <Plus className="h-4 w-4 mr-1" /> Adicionar
        </Button>
      </div>
    </Card>
  );
}
