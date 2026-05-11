import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const WD = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export default function ZonesList() {
  const { data: zones = [] } = useQuery({
    queryKey: ["zones-list"],
    queryFn: async () =>
      (await supabase
        .from("delivery_zones")
        .select("*")
        .order("name")).data ?? [],
  });

  return (
    <>
      <PageHeader
        title="Zonas de Entrega"
        breadcrumb={[{ label: "Rotas", to: "/routes" }, { label: "Zonas" }]}
        actions={
          <Button asChild size="sm">
            <Link to="/routes/zones/new"><Plus className="h-4 w-4 mr-1" />Nova zona</Link>
          </Button>
        }
      />
      <PageBody>
        {zones.length === 0 ? (
          <EmptyState
            title="Sem zonas"
            description="Defina faixas de código postal para criar rotas automaticamente."
            action={<Button asChild><Link to="/routes/zones/new">Criar zona</Link></Button>}
          />
        ) : (
          <Card>
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2">Nome</th>
                  <th className="text-left px-3 py-2">CP</th>
                  <th className="text-left px-3 py-2">Dias</th>
                  <th className="text-left px-3 py-2">Capacidade/dia</th>
                  <th className="text-left px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {(zones as any[]).map((z) => (
                  <tr key={z.id} className="border-t hover:bg-accent/30">
                    <td className="px-3 py-2">
                      <Link to={`/routes/zones/${z.id}`} className="text-primary hover:underline font-medium flex items-center gap-2">
                        {z.color && <span className="inline-block h-3 w-3 rounded-full border" style={{ backgroundColor: z.color }} />}
                        {z.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{z.zip_from} – {z.zip_to}</td>
                    <td className="px-3 py-2 text-xs">
                      {(z.weekdays ?? []).map((d: number) => WD[d - 1] ?? "").join(", ")}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {z.max_deliveries_per_day} entregas · {z.max_assembly_minutes_per_day} min
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={z.active ? "default" : "secondary"}>{z.active ? "Ativa" : "Inativa"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </PageBody>
    </>
  );
}
