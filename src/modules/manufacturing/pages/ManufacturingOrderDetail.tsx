import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ComponentStockChip } from "../components/MOBadges";
import { MOOriginBadge } from "../components/MOOriginBadge";
import { AttachmentsGrid } from "../components/PhotoUploader";
import { fmtDate, fmtDateTime } from "@/lib/format";
import WorkOrdersSection from "../components/WorkOrdersSection";
import { RecordTimeline } from "@/core/timeline/RecordTimeline";
import { RecordTasks } from "@/core/tasks/RecordTasks";
import { RecordConversations } from "@/core/conversations/RecordConversations";
import {
  EntityHeader,
  OperationalStatusBadge,
  EmptyState,
  LoadingState,
  type OperationalAction,
} from "@/core/operational";
import { useRpcMutation } from "@/core/operational/hooks/useRpcMutation";
import { useEntityRefresh } from "@/core/operational/hooks/useEntityRefresh";

const CLOSE_ERROR_MESSAGES: Record<string, string> = {
  WORK_ORDERS_NOT_DONE: "Ainda existem operações abertas.",
  QUALITY_CHECK_REQUIRED: "Existe controlo de qualidade obrigatório pendente.",
  OPEN_BLOCKING_ISSUES: "Existem problemas bloqueantes abertos.",
};

function closeErrorMessage(raw: string) {
  for (const k of Object.keys(CLOSE_ERROR_MESSAGES)) {
    if (raw.includes(k)) return CLOSE_ERROR_MESSAGES[k];
  }
  return raw;
}

export default function ManufacturingOrderDetail() {
  const { id } = useParams();
  const qc = useQueryClient();

  const { refresh, lastUpdated, isFetching } = useEntityRefresh({
    entityType: "manufacturing_order",
    entityId: id,
    extraKeys: [
      ["mo-comps", id],
      ["mo-ops", id],
      ["mo-iss", id],
      ["mo-qc", id],
      ["purchase_needs"],
    ],
  });

  const { data: mo, isLoading } = useQuery({
    queryKey: ["manufacturing_order", id],
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

  const closeMo = useRpcMutation<{ _mo: string }, unknown>({
    rpc: "close_mo",
    successMessage: "Ordem fechada",
    onSuccess: () => refresh(),
    onError: (err) => toast.error(closeErrorMessage(err.message)),
  });

  const generateNeeds = useRpcMutation<{ _mo: string }, number>({
    rpc: "mfg_create_needs_for_mo",
    onSuccess: async (data) => {
      toast.success(`${data ?? 0} necessidade(s) de compra criada(s)`);
      await refresh();
    },
    invalidateKeys: [["purchase_needs"]],
  });

  const resolveIssue = async (issueId: string) => {
    const resolution = prompt("Resolução do problema?") ?? "";
    if (!resolution) return;
    const { error } = await supabase.rpc("mfg_resolve_issue", { _issue: issueId, _resolution: resolution });
    if (error) toast.error(error.message);
    else { toast.success("Problema resolvido"); await refresh(); qc.invalidateQueries({ queryKey: ["mo-iss", id] }); }
  };

  if (isLoading || !mo) {
    return <PageBody><LoadingState rows={6} /></PageBody>;
  }

  const isTerminal = mo.state === "done" || mo.state === "cancelled";
  const closeDisabledReason = isTerminal
    ? mo.state === "done" ? "A ordem já está concluída." : "A ordem está cancelada."
    : null;

  const actions: OperationalAction[] = [
    {
      key: "refresh-needs",
      label: "Gerar necessidades",
      onClick: async () => { await generateNeeds.mutateAsync({ _mo: id! }); },
      loading: generateNeeds.isPending,
      disabled: isTerminal,
      disabledReason: closeDisabledReason ?? undefined,
    },
    {
      key: "shopfloor",
      label: "Abrir no chão de fábrica",
      onClick: () => { window.location.href = `/shop-floor/order/${mo.id}`; },
    },
    {
      key: "close",
      label: "Fechar OF",
      variant: "default",
      onClick: () => closeMo.mutateAsync({ _mo: id! }),
      loading: closeMo.isPending,
      disabled: isTerminal,
      disabledReason: closeDisabledReason ?? undefined,
      confirm: {
        title: "Fechar ordem de fabrico?",
        description: "Esta ação valida operações, qualidade e problemas abertos antes de concluir.",
        confirmLabel: "Fechar OF",
      },
    },
  ];

  return (
    <>
      <EntityHeader
        title={`${mo.code} — ${mo.product?.name ?? ""}`}
        breadcrumb={[
          { label: "Manufatura", to: "/manufacturing" },
          { label: "Ordens", to: "/manufacturing/orders" },
          { label: mo.code },
        ]}
        statusBadges={
          <>
            <MOOriginBadge origin={mo.origin} />
            <OperationalStatusBadge domain="manufacturing" status={mo.state} />
            {mo.blocked_reason && (
              <span className="text-xs text-destructive">⚠ {mo.blocked_reason}</span>
            )}
          </>
        }
        metadata={[
          { label: "Quantidade", value: Number(mo.qty) },
          { label: "Prazo", value: fmtDate(mo.due_date) || "—" },
          { label: "BOM", value: mo.bom?.code ?? "—" },
          { label: "Cliente", value: mo.partner?.name ?? "—" },
          {
            label: "Venda",
            value: mo.sale ? (
              <Link className="underline" to={`/sales/orders/${mo.sale.id}`}>{mo.sale.name}</Link>
            ) : "—",
          },
          { label: "Criada em", value: fmtDateTime(mo.created_at) },
        ]}
        primaryActions={actions}
        onRefresh={refresh}
        isFetching={isFetching}
        lastUpdated={lastUpdated}
      />
      <PageBody>
        <Card className="p-4">
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
              <WorkOrdersSection moId={id!} />
            </TabsContent>

            <TabsContent value="quality">
              {qcs?.length ? qcs.map((q: any) => (
                <div key={q.id} className="border-b py-2 text-sm">
                  <div><strong>{q.result}</strong> — {fmtDateTime(q.checked_at)}</div>
                  {q.defects && <div className="text-destructive">Defeitos: {q.defects}</div>}
                  {q.notes && <div className="text-muted-foreground">{q.notes}</div>}
                  <AttachmentsGrid items={q.attachments} />
                </div>
              )) : <EmptyState title="Sem registos de qualidade" />}
            </TabsContent>

            <TabsContent value="issues">
              {issues?.length ? issues.map((i: any) => (
                <div key={i.id} className="border-b py-2 text-sm">
                  <div><strong>{i.kind}</strong> — {fmtDateTime(i.reported_at)}</div>
                  {i.description && <div>{i.description}</div>}
                  {i.resolved_at
                    ? <div className="text-emerald-600">Resolvido em {fmtDateTime(i.resolved_at)}{i.resolution && ` — ${i.resolution}`}</div>
                    : <Button size="sm" variant="outline" className="mt-1" onClick={() => resolveIssue(i.id)}>Marcar como resolvido</Button>}
                  <AttachmentsGrid items={i.attachments} />
                </div>
              )) : <EmptyState title="Sem problemas reportados" />}
            </TabsContent>
          </Tabs>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <RecordTasks entityType="manufacturing_order" entityId={id!} />
          <RecordTimeline entityType="manufacturing_order" entityId={id!} />
        </div>
        <div className="mt-4">
          <RecordConversations entityType="manufacturing_order" entityId={id!} />
        </div>
      </PageBody>
    </>
  );
}
