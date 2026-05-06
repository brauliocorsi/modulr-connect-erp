import { fmtMoney } from "@/lib/format";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LayoutGrid, List } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

const COLS: { key: string; label: string }[] = [
  { key: "draft", label: "Rascunho" },
  { key: "rfq_sent", label: "RFQ Enviada" },
  { key: "confirmed", label: "Confirmada" },
  { key: "done", label: "Concluída" },
  { key: "cancelled", label: "Cancelada" },
];

export default function RfqKanban() {
  const qc = useQueryClient();
  const [dragId, setDragId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["po-kanban"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("id, name, state, amount_total, expected_date, partners(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const move = useMutation({
    mutationFn: async ({ id, state }: { id: string; state: string }) => {
      const { error } = await supabase.from("purchase_orders").update({ state: state as any }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["po-kanban"] });
      toast.success("Estado atualizado");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const grouped = COLS.map((c) => ({
    ...c,
    items: (data ?? []).filter((d: any) => d.state === c.key),
  }));

  return (
    <>
      <PageHeader
        title="Kanban de Cotações"
        breadcrumb={[{ label: "Compras", to: "/purchase" }, { label: "Kanban" }]}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/purchase/orders"><List className="h-4 w-4 mr-1" /> Lista</Link>
          </Button>
        }
        createTo="/purchase/orders/new"
      />
      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {grouped.map((col) => (
            <div
              key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragId) move.mutate({ id: dragId, state: col.key });
                setDragId(null);
              }}
              className="bg-muted/40 rounded-lg p-2 min-h-[400px]"
            >
              <div className="flex items-center justify-between px-2 py-1 mb-2">
                <div className="text-sm font-semibold">{col.label}</div>
                <div className="text-xs text-muted-foreground">{col.items.length}</div>
              </div>
              <div className="space-y-2">
                {col.items.map((it: any) => (
                  <Card
                    key={it.id}
                    draggable
                    onDragStart={() => setDragId(it.id)}
                    className="p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
                  >
                    <Link to={`/purchase/orders/${it.id}`} className="block">
                      <div className="font-medium text-sm">{it.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">{it.partners?.name ?? "—"}</div>
                      <div className="flex justify-between mt-2 text-xs">
                        <span>{it.expected_date ?? ""}</span>
                        <span className="font-semibold">{fmtMoney(it.amount_total)}</span>
                      </div>
                    </Link>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PageBody>
    </>
  );
}
