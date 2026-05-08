import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, ArrowDownToLine, ArrowUpFromLine, RefreshCw } from "lucide-react";
import { AdvancedFilters, FilterValues } from "@/modules/inventory/components/AdvancedFilters";

const KIND_ICON: Record<string, any> = { incoming: ArrowDownToLine, outgoing: ArrowUpFromLine, internal: RefreshCw };
const STATE_COLOR: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  waiting: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  ready: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  done: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  cancelled: "bg-destructive/10 text-destructive",
};

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

export default function SchedulePage() {
  const [cursor, setCursor] = useState(startOfMonth(new Date()));
  const [filters, setFilters] = useState<FilterValues>({});

  const monthStart = cursor;
  const monthEnd = addMonths(cursor, 1);

  const { data: pickings } = useQuery({
    queryKey: ["schedule", monthStart.toISOString(), filters],
    queryFn: async () => {
      let q: any = supabase
        .from("stock_pickings")
        .select("id,name,kind,state,scheduled_at,origin, partners(name), warehouses(name)")
        .gte("scheduled_at", monthStart.toISOString())
        .lt("scheduled_at", monthEnd.toISOString())
        .order("scheduled_at");
      if (filters.kind) q = q.eq("kind", filters.kind);
      if (filters.state) q = q.eq("state", filters.state);
      if (filters.warehouse_id) q = q.eq("warehouse_id", filters.warehouse_id);
      if (filters.origin) q = q.ilike("origin", `%${filters.origin}%`);
      const { data } = await q.limit(500);
      return data ?? [];
    },
  });

  const { data: warehouses } = useQuery({
    queryKey: ["warehouses-min"],
    queryFn: async () => (await supabase.from("warehouses").select("id,name").order("name")).data ?? [],
  });

  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    (pickings ?? []).forEach((p: any) => {
      if (!p.scheduled_at) return;
      const k = new Date(p.scheduled_at).toISOString().slice(0, 10);
      m.set(k, [...(m.get(k) ?? []), p]);
    });
    return m;
  }, [pickings]);

  const days = useMemo(() => {
    const first = startOfMonth(cursor);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells: { date: Date | null }[] = [];
    for (let i = 0; i < offset; i++) cells.push({ date: null });
    for (let d = 1; d <= total; d++) cells.push({ date: new Date(cursor.getFullYear(), cursor.getMonth(), d) });
    while (cells.length % 7 !== 0) cells.push({ date: null });
    return cells;
  }, [cursor]);

  const monthLabel = cursor.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });

  return (
    <>
      <PageHeader
        title="Cronograma de entregas"
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Cronograma" }]}
      />
      <PageBody>
        <Card className="p-3 mb-4">
          <AdvancedFilters
            onChange={setFilters}
            fields={[
              { key: "kind", label: "Tipo", type: "select", options: [
                { value: "incoming", label: "Entrada" }, { value: "outgoing", label: "Saída" }, { value: "internal", label: "Interna" },
              ]},
              { key: "state", label: "Estado", type: "select", options: [
                { value: "draft", label: "Rascunho" }, { value: "waiting", label: "Aguardando" },
                { value: "ready", label: "Pronto" }, { value: "done", label: "Concluído" }, { value: "cancelled", label: "Cancelado" },
              ]},
              { key: "warehouse_id", label: "Armazém", type: "select", options: (warehouses ?? []).map((w: any) => ({ value: w.id, label: w.name })) },
              { key: "origin", label: "Origem (SO/PO)", type: "text" },
            ]}
          />
        </Card>

        <Tabs defaultValue="calendar">
          <TabsList>
            <TabsTrigger value="calendar">Calendário</TabsTrigger>
            <TabsTrigger value="list">Lista</TabsTrigger>
          </TabsList>

          <TabsContent value="calendar">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <Button variant="ghost" size="icon" onClick={() => setCursor(addMonths(cursor, -1))}><ChevronLeft className="h-4 w-4" /></Button>
                <div className="font-semibold capitalize">{monthLabel}</div>
                <Button variant="ghost" size="icon" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight className="h-4 w-4" /></Button>
              </div>
              <div className="grid grid-cols-7 gap-px bg-border rounded overflow-hidden">
                {["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map((d) => (
                  <div key={d} className="bg-muted/40 text-xs font-medium text-center py-1">{d}</div>
                ))}
                {days.map((c, i) => {
                  const k = c.date ? c.date.toISOString().slice(0, 10) : "";
                  const items = c.date ? byDay.get(k) ?? [] : [];
                  const isToday = c.date && c.date.toDateString() === new Date().toDateString();
                  return (
                    <div key={i} className={`bg-card min-h-[110px] p-1.5 text-xs ${isToday ? "ring-1 ring-primary" : ""}`}>
                      {c.date && (
                        <>
                          <div className={`text-[11px] font-medium mb-1 ${isToday ? "text-primary" : "text-muted-foreground"}`}>{c.date.getDate()}</div>
                          <div className="space-y-0.5">
                            {items.slice(0, 4).map((p: any) => {
                              const Icon = KIND_ICON[p.kind] ?? RefreshCw;
                              return (
                                <Link key={p.id} to={`/inventory/transfers/${p.id}`}
                                  className={`flex items-center gap-1 px-1 py-0.5 rounded truncate ${STATE_COLOR[p.state] ?? "bg-muted"}`}>
                                  <Icon className="h-3 w-3 shrink-0" />
                                  <span className="truncate">{p.name}</span>
                                </Link>
                              );
                            })}
                            {items.length > 4 && <div className="text-muted-foreground">+{items.length - 4} mais</div>}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="list">
            <Card>
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2">Programado</th>
                    <th className="text-left px-3 py-2">Documento</th>
                    <th className="text-left px-3 py-2">Tipo</th>
                    <th className="text-left px-3 py-2">Parceiro</th>
                    <th className="text-left px-3 py-2">Armazém</th>
                    <th className="text-left px-3 py-2">Estado</th>
                    <th className="text-left px-3 py-2">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {(pickings ?? []).length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Sem entregas no período.</td></tr>
                  ) : pickings!.map((p: any) => (
                    <tr key={p.id} className="border-t">
                      <td className="px-3 py-2">{p.scheduled_at ? new Date(p.scheduled_at).toLocaleString("pt-PT") : "—"}</td>
                      <td className="px-3 py-2"><Link to={`/inventory/transfers/${p.id}`} className="text-primary hover:underline">{p.name}</Link></td>
                      <td className="px-3 py-2">{p.kind}</td>
                      <td className="px-3 py-2">{p.partners?.name ?? "—"}</td>
                      <td className="px-3 py-2">{p.warehouses?.name ?? "—"}</td>
                      <td className="px-3 py-2"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${STATE_COLOR[p.state] ?? "bg-muted"}`}>{p.state}</span></td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.origin ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
