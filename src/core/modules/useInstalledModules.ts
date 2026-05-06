import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useInstalledModules() {
  return useQuery({
    queryKey: ["installed_modules"],
    queryFn: async () => {
      const { data } = await supabase.from("installed_modules").select("module, installed");
      const map: Record<string, boolean> = {};
      (data ?? []).forEach((r: any) => (map[r.module] = r.installed));
      return map;
    },
  });
}
