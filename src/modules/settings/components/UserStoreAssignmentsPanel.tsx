import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Star, StarOff, Trash2, Plus } from "lucide-react";
import { useRpcMutation } from "@/core/operational/hooks/useRpcMutation";
import { ConfirmActionDialog } from "@/core/operational/ConfirmActionDialog";

const ROLES = ["staff", "manager", "cashier", "logistics", "service"] as const;

export function UserStoreAssignmentsPanel({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const invalidate = [["user-store-assignments", userId]];
  const [storeId, setStoreId] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("staff");
  const [removeTarget, setRemoveTarget] = useState<{ id: string; reason: string } | null>(null);

  const { data: stores } = useQuery({
    queryKey: ["stores-active"],
    queryFn: async () => {
      const { data } = await supabase.from("stores").select("id, name, code").order("name");
      return data ?? [];
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["user-store-assignments", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_store_assignments")
        .select("id, store_id, role, is_default, active, removed_reason, stores(name, code)")
        .eq("user_id", userId)
        .order("created_at");
      return data ?? [];
    },
  });

  const upsert = useRpcMutation({
    rpc: "user_store_assignment_upsert",
    successMessage: "Loja atribuída",
    invalidateKeys: invalidate,
    onSuccess: () => {
      setStoreId("");
      setRole("staff");
    },
  });
  const setDefault = useRpcMutation({
    rpc: "user_store_assignment_set_default",
    successMessage: "Loja por defeito atualizada",
    invalidateKeys: invalidate,
  });
  const remove = useRpcMutation({
    rpc: "user_store_assignment_remove",
    successMessage: "Loja removida",
    invalidateKeys: invalidate,
    onSuccess: () => setRemoveTarget(null),
  });

  return (
    <Card className="p-6 max-w-3xl space-y-4" data-testid="user-store-assignments">
      <div>
        <div className="font-semibold">Lojas atribuídas</div>
        <div className="text-xs text-muted-foreground">
          Define em que lojas este utilizador pode operar caixa, vendas e logística.
        </div>
      </div>

      <div className="space-y-2">
        {(rows ?? []).length === 0 && (
          <div className="text-sm text-muted-foreground italic">Sem lojas atribuídas.</div>
        )}
        {(rows ?? []).map((r: any) => (
          <div
            key={r.id}
            className="flex items-center gap-3 border rounded-md p-2"
            data-testid={`assignment-${r.id}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{r.stores?.name ?? r.store_id}</span>
                {r.is_default && <Badge variant="default">Default</Badge>}
                {!r.active && <Badge variant="secondary">Inativo</Badge>}
                <Badge variant="outline">{r.role}</Badge>
              </div>
              {r.removed_reason && (
                <div className="text-xs text-muted-foreground mt-0.5">{r.removed_reason}</div>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={!r.active || r.is_default || setDefault.isPending}
              onClick={() => setDefault.mutate({ _assignment_id: r.id })}
              aria-label="Marcar default"
            >
              {r.is_default ? <Star className="h-4 w-4" /> : <StarOff className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!r.active}
              onClick={() => setRemoveTarget({ id: r.id, reason: "" })}
              aria-label="Remover loja"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
        <div>
          <Label>Adicionar loja</Label>
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger><SelectValue placeholder="Selecione loja…" /></SelectTrigger>
            <SelectContent>
              {(stores ?? []).map((s: any) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Função</Label>
          <Select value={role} onValueChange={(v) => setRole(v as any)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={!storeId || upsert.isPending}
          onClick={() =>
            upsert.mutate({
              _user_id: userId,
              _store_id: storeId,
              _role: role,
              _is_default: (rows ?? []).length === 0,
              _active: true,
            })
          }
        >
          <Plus className="h-4 w-4 mr-1" /> Atribuir
        </Button>
      </div>

      <ConfirmActionDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        title="Remover loja do utilizador"
        description={
          <div className="space-y-2">
            <p>O assignment fica inativo. Indique o motivo:</p>
            <Input
              autoFocus
              value={removeTarget?.reason ?? ""}
              onChange={(e) =>
                setRemoveTarget((t) => (t ? { ...t, reason: e.target.value } : t))
              }
              placeholder="Motivo da remoção"
            />
          </div>
        }
        destructive
        loading={remove.isPending}
        confirmLabel="Remover"
        onConfirm={() =>
          removeTarget?.reason
            ? remove.mutate({ _assignment_id: removeTarget.id, _reason: removeTarget.reason })
            : undefined
        }
      />
    </Card>
  );
}
