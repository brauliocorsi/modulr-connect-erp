import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MOStateBadge, MOPriorityBadge, ComponentStockChip } from "../components/MOBadges";
import { AttachmentsGrid } from "../components/PhotoUploader";
import { fmtDate, fmtDateTime } from "@/lib/format";

export default function ManufacturingOrderDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const resolveIssue = async (issueId: string) => {
    const resolution = prompt("Resolução do problema?") ?? "";
    if (!resolution) return;
    const { error } = await supabase.rpc("mfg_resolve_issue", { _issue: issueId, _resolution: resolution });
    if (error) toast.error(error.message);
    else { toast.success("Problema resolvido"); qc.invalidateQueries({ queryKey: ["mo-iss", id] }); qc.invalidateQueries({ queryKey: ["mo", id] }); }
  };
  const { data: mo } = useQuery({
    queryKey: ["mo", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("manufacturing_orders")
        .select("*, product:products(name,internal_ref), partner:partners(name), sale:sale_orders(id,name), bom:boms(code)")
        .eq("id", id!)
        .maybeSingle();
      return data;
    },
  });
  const { data: comps } = useQuery({
    queryKey: ["mo-comps", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("mo_components").select("*, product:products(name,internal_ref)").eq("mo_id", id!).order("sequence")).data ?? [],
  });
  const { data: ops } = useQuery({
    queryKey: ["mo-ops", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("mo_operations").select("*").eq("mo_id", id!).order("sequence")).data ?? [],
  });
  const { data: issues } = useQuery({
    queryKey: ["mo-iss", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("mo_issues").select("*").eq("mo_id", id!).order("reported_at", { ascending: false })).data ?? [],
  });
  const { data: qcs } = useQuery({
    queryKey: ["mo-qc", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("mo_quality_checks").select("*").eq("mo_id", id!).order("checked_at", { ascending: false })).data ?? [],
  });

  if (!mo) return <PageBody><div className="text-sm text-muted-foreground">Carregando…</div></PageBody>;

  return (
    <>
      <PageHeader
        title={`${mo.code} — ${mo.product?.name ?? ""}`}
        breadcrumb={[{ label: "Manufatura", to: "/manufacturing" }, { label: "Ordens", to: "/manufacturing/orders" }, { label: mo.code }]}
        actions={
          <div className="flex gap-2 items-center">
            <MOPriorityBadge priority={mo.priority} />
            <MOStateBadge state={mo.state} />
          </div>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <Card className="p-4 lg:col-span-1 space-y-2 text-sm">
            <div><span className="text-muted-foreground">Cliente:</span> {mo.partner?.name ?? "—"}</div>
            <div><span className="text-muted-foreground">Quantidade:</span> {Number(mo.qty)}</div>
            <div><span className="text-muted-foreground">Prazo:</span> {fmtDate(mo.due_date)}</div>
            <div><span className="text-muted-foreground">BOM:</span> {mo.bom?.code ?? "—"}</div>
            <div><span className="text-muted-foreground">Venda:</span> {mo.sale ? <Link className="underline" to={`/sales/orders/${mo.sale.id}`}>{mo.sale.name}</Link> : "—"}</div>
            {mo.blocked_reason && <div className="text-destructive">⚠ {mo.blocked_reason}</div>}
            {mo.notes && <div className="text-muted-foreground whitespace-pre-wrap">{mo.notes}</div>}
            <div className="pt-2"><Link to={`/shop-floor/order/${mo.id}`} className="text-primary underline text-sm">Abrir no chão de fábrica →</Link></div>
          </Card>

          <Card className="p-4 lg:col-span-3">
            <Tabs defaultValue="components">
              <TabsList>
                <TabsTrigger value="components">Componentes</TabsTrigger>
                <TabsTrigger value="operations">Operações</TabsTrigger>
                <TabsTrigger value="quality">Qualidade</TabsTrigger>
                <TabsTrigger value="issues">Problemas</TabsTrigger>
              </TabsList>

              <TabsContent value="components">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr><th className="py-2">Produto</th><th>Necessário</th><th>Disponível</th><th>Consumido</th><th>Estado</th></tr>
                  </thead>
                  <tbody>
                    {comps?.map((c: any) => (
                      <tr key={c.id} className="border-b last:border-0">
                        <td className="py-2">{c.product?.name ?? c.product_id}</td>
                        <td>{Number(c.qty_required)}</td>
                        <td>{Number(c.qty_available)}</td>
                        <td>{Number(c.qty_consumed)}</td>
                        <td><ComponentStockChip status={c.status} /></td>
                      </tr>
                    ))}
                    {!comps?.length && <tr><td colSpan={5} className="py-3 text-muted-foreground">Sem componentes.</td></tr>}
                  </tbody>
                </table>
              </TabsContent>

              <TabsContent value="operations">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr><th className="py-2">#</th><th>Etapa</th><th>Centro</th><th>Min.</th><th>Estado</th><th>Início</th><th>Fim</th></tr>
                  </thead>
                  <tbody>
                    {ops?.map((o: any) => (
                      <tr key={o.id} className="border-b last:border-0">
                        <td className="py-2">{o.sequence}</td>
                        <td>{o.name}{o.is_qc && " (QC)"}{o.is_rework && " (retrabalho)"}</td>
                        <td>{o.workcenter ?? "—"}</td>
                        <td>{Number(o.planned_minutes)}</td>
                        <td>{o.state}</td>
                        <td>{o.started_at ? fmtDateTime(o.started_at) : "—"}</td>
                        <td>{o.finished_at ? fmtDateTime(o.finished_at) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TabsContent>

              <TabsContent value="quality">
                {qcs?.length ? qcs.map((q: any) => (
                  <div key={q.id} className="border-b py-2 text-sm">
                    <div><strong>{q.result}</strong> — {fmtDateTime(q.checked_at)}</div>
                    {q.defects && <div className="text-destructive">Defeitos: {q.defects}</div>}
                    {q.notes && <div className="text-muted-foreground">{q.notes}</div>}
                    <AttachmentsGrid items={q.attachments} />
                  </div>
                )) : <div className="text-sm text-muted-foreground py-3">Sem registos de qualidade.</div>}
              </TabsContent>

              <TabsContent value="issues">
                {issues?.length ? issues.map((i: any) => (
                  <div key={i.id} className="border-b py-2 text-sm">
                    <div><strong>{i.kind}</strong> — {fmtDateTime(i.reported_at)}</div>
                    {i.description && <div>{i.description}</div>}
                    {i.resolved_at && <div className="text-emerald-600">Resolvido em {fmtDateTime(i.resolved_at)}</div>}
                    <AttachmentsGrid items={i.attachments} />
                  </div>
                )) : <div className="text-sm text-muted-foreground py-3">Sem problemas reportados.</div>}
              </TabsContent>
            </Tabs>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
