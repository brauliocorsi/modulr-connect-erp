import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { WorkOrderStateBadge } from "@/modules/manufacturing/components/WorkOrdersSection";

type Col = { key: string; label: string; states: string[] };
const COLS: Col[] = [
  { key: "waiting", label: "Aguardando", states: ["pending"] },
  { key: "ready", label: "Pronta", states: ["ready"] },
  { key: "running", label: "Em execução", states: ["in_progress"] },
  { key: "paused", label: "Pausada", states: ["paused"] },
  { key: "blocked", label: "Bloqueada", states: ["blocked"] },
  { key: "done", label: "Concluída", states: ["done"] },
];

export default function ShopFloorBoard() {
  const [wcFilter, setWcFilter] = useState<string>("all");
  const [machineFilter, setMachineFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const wcsQ = useQuery({
    queryKey: ["sf-wcs"],
    queryFn: async () => (await supabase.from("work_centers").select("id,name").eq("active", true).order("name")).data ?? [],
  });
  const machinesQ = useQuery({
    queryKey: ["sf-machines"],
    queryFn: async () => (await supabase.from("manufacturing_machines").select("id,name").eq("active", true).order("name")).data ?? [],
  });

  const wosQ = useQuery({
    queryKey: ["sf-board-wo", wcFilter, machineFilter],
    queryFn: async () => {
      let q = supabase
        .from("mo_operations")
        .select("id, sequence, name, state, planned_minutes, actual_duration_minutes, actual_start_at, qty_done, qty_scrap, is_qc, block_reason, mo_id, work_center_id, machine_id, assigned_employee_id, mo:manufacturing_orders!inner(id, code, priority, qty, due_date, state, product:products(name)), work_center:work_centers(name), machine:manufacturing_machines(name)")
        .order("sequence")
        .limit(500);
      if (wcFilter !== "all") q = q.eq("work_center_id", wcFilter);
      if (machineFilter !== "all") q = q.eq("machine_id", machineFilter);
      const { data } = await q;
      return (data ?? []).filter((w: any) => w.mo?.state !== "cancelled");
    },
  });

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return (wosQ.data ?? []).filter((w: any) =>
      !term || w.mo?.code?.toLowerCase().includes(term) || w.mo?.product?.name?.toLowerCase().includes(term) || w.name?.toLowerCase().includes(term)
    );
  }, [wosQ.data, search]);

  return (
    <>
      <PageHeader title="Chão de Fábrica" breadcrumb={[{ label: "Chão de Fábrica" }]} />
      <PageBody>
        <Card className="p-3 mb-3 flex flex-wrap gap-2 items-center">
          <Input placeholder="Buscar OF / produto / operação" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <Select value={wcFilter} onValueChange={setWcFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Centro de trabalho" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os centros</SelectItem>
              {wcsQ.data?.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={machineFilter} onValueChange={setMachineFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Máquina" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as máquinas</SelectItem>
              {machinesQ.data?.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground ml-auto">{filtered.length} work order(s)</div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          {COLS.map((c) => {
            const items = filtered.filter((w: any) => c.states.includes(w.state));
            return (
              <Card key={c.key} className="p-3 min-h-[60vh]">
                <div className="font-semibold text-sm mb-3 flex items-center justify-between">
                  <span>{c.label}</span>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((w: any) => (
                    <Link key={w.id} to={`/manufacturing/orders/${w.mo_id}`} className="block border rounded-lg p-2 hover:bg-muted/40">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-xs">{w.mo?.code}</div>
                        <WorkOrderStateBadge state={w.state} />
                      </div>
                      <div className="text-xs mt-1 truncate">{w.sequence}. {w.name}{w.is_qc && " (QC)"}</div>
                      <div className="text-xs text-muted-foreground truncate">{w.mo?.product?.name}</div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {w.work_center?.name ?? "—"} • {w.machine?.name ?? "sem máquina"}
                      </div>
                      <div className="text-[10px] mt-1">
                        Plan {Number(w.planned_minutes)}min • Feito {Number(w.qty_done)}/{Number(w.mo?.qty)}
                      </div>
                      {w.block_reason && <Badge variant="destructive" className="mt-1 text-[10px]">⚠ {w.block_reason}</Badge>}
                    </Link>
                  ))}
                  {!items.length && <div className="text-xs text-muted-foreground italic">—</div>}
                </div>
              </Card>
            );
          })}
        </div>
      </PageBody>
    </>
  );
}
