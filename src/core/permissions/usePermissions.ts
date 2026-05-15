import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";

export type ModuleId = "core" | "products" | "sales" | "purchase" | "inventory" | "manufacturing" | "shopfloor";
export type Action = "view" | "create" | "edit" | "delete" | "export";

export function usePermissions() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["permissions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: groups } = await supabase
        .from("user_groups")
        .select("group_id, groups(code)")
        .eq("user_id", user!.id);
      const codes = (groups ?? []).map((g: any) => g.groups?.code).filter(Boolean) as string[];
      const groupIds = (groups ?? []).map((g: any) => g.group_id);
      const { data: perms } = groupIds.length
        ? await supabase
            .from("group_permissions")
            .select("module, entity, action")
            .in("group_id", groupIds)
        : { data: [] as any[] };
      const set = new Set<string>();
      (perms ?? []).forEach((p: any) => set.add(`${p.module}:${p.entity}:${p.action}`));
      return { groups: codes, perms: set };
    },
  });

  const isAdmin = data?.groups.includes("system_admin") ?? false;
  const can = (module: ModuleId, entity: string, action: Action) =>
    isAdmin || (data?.perms.has(`${module}:${entity}:${action}`) ?? false);
  const inGroup = (code: string) => data?.groups.includes(code) ?? false;

  return { isAdmin, can, inGroup, loading: isLoading, groups: data?.groups ?? [] };
}
