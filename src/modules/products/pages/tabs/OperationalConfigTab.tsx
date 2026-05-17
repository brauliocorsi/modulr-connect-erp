import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RefreshCw, Info } from "lucide-react";

const SUPPLY_ROUTES = [
  { v: "buy", l: "Comprar" },
  { v: "manufacture", l: "Fabricar" },
  { v: "buy_or_manufacture", l: "Comprar ou fabricar" },
  { v: "manual", l: "Manual" },
];
const ALLOC_POLICIES = [
  { v: "strict_order", l: "Ordem estrita" },
  { v: "stock_pool_first", l: "Stock pool primeiro" },
  { v: "oldest_order_first", l: "Pedido mais antigo primeiro" },
  { v: "delivery_date_first", l: "Data de entrega primeiro" },
  { v: "paid_priority", l: "Prioridade de pago" },
  { v: "manual_allocation", l: "Alocação manual" },
  { v: "custom_priority", l: "Prioridade customizada" },
];
const COMP_POLICIES = [
  { v: "manufacturing_first", l: "Fabrico primeiro" },
  { v: "sales_first", l: "Vendas primeiro" },
  { v: "oldest_need_first", l: "Necessidade mais antiga primeiro" },
  { v: "manual", l: "Manual" },
];

export function OperationalConfigTab({ productId }: { productId: string }) {
  const [state, setState] = useState({
    supply_route: "buy",
    allocation_policy: "strict_order",
    component_allocation_policy: "manufacturing_first",
    package_tracking_enabled: false,
  });
  const [mfgCheck, setMfgCheck] = useState<any>(null);
  const [pkgDiag, setPkgDiag] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: p }, { data: mc }, { data: pd }] = await Promise.all([
      supabase
        .from("products")
        .select("supply_route,allocation_policy,component_allocation_policy,package_tracking_enabled")
        .eq("id", productId)
        .maybeSingle(),
      supabase.rpc("product_manufacturing_configuration_check", { _product_id: productId }),
      supabase.rpc("package_tracking_diagnostic", { _product_id: productId }),
    ]);
    if (p) {
      setState({
        supply_route: (p as any).supply_route ?? "buy",
        allocation_policy: (p as any).allocation_policy ?? "strict_order",
        component_allocation_policy: (p as any).component_allocation_policy ?? "manufacturing_first",
        package_tracking_enabled: !!(p as any).package_tracking_enabled,
      });
    }
    setMfgCheck(mc as any);
    setPkgDiag(pd as any);
  };

  useEffect(() => {
    load();
  }, [productId]);

  const save = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("update_product_operational_config", {
      _product_id: productId,
      _supply_route: state.supply_route,
      _allocation_policy: state.allocation_policy,
      _component_allocation_policy: state.component_allocation_policy,
      _package_tracking_enabled: state.package_tracking_enabled,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const warnings = (data as any)?.warnings ?? [];
    if (warnings.length) {
      warnings.forEach((w: any) => toast.warning(w.message ?? w.code));
    } else {
      toast.success("Configuração operacional salva");
    }
    load();
  };

  const onTogglePkg = async (next: boolean) => {
    if (!next) {
      setState((s) => ({ ...s, package_tracking_enabled: false }));
      return;
    }
    // Pre-check via diagnostic
    const { data: d, error } = await supabase.rpc("package_tracking_diagnostic", { _product_id: productId });
    if (error) return toast.error(error.message);
    setPkgDiag(d as any);
    if (!(d as any)?.ready_for_activation) {
      const codes = ((d as any)?.blockers ?? []).map((b: any) => b.code).join(", ") || "not_ready";
      toast.error(`Não pronto para ativar: ${codes}`);
      return;
    }
    setState((s) => ({ ...s, package_tracking_enabled: true }));
  };

  const blockers: any[] = pkgDiag?.blockers ?? [];
  const mfgBlockers: any[] = mfgCheck?.blockers ?? [];
  const mfgWarnings: any[] = mfgCheck?.warnings ?? [];
  const mfgReady = !!mfgCheck?.ready_for_activation || !!mfgCheck?.manufacturing_ready;

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-4">
        <div className="o-section-title">Rotas e Políticas</div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Rota de fornecimento</Label>
            <Select value={state.supply_route} onValueChange={(v) => setState({ ...state, supply_route: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUPPLY_ROUTES.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Política de alocação (vendas)</Label>
            <Select value={state.allocation_policy} onValueChange={(v) => setState({ ...state, allocation_policy: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALLOC_POLICIES.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Política de alocação de componentes</Label>
            <Select
              value={state.component_allocation_policy}
              onValueChange={(v) => setState({ ...state, component_allocation_policy: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMP_POLICIES.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Relevante apenas para matérias-primas/componentes.</p>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-semibold flex items-center gap-2">
              Package tracking por produto
              {state.package_tracking_enabled ? <Badge>ON</Badge> : <Badge variant="outline">OFF</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Ativa rastreio físico colis-a-colis. Só pode ser ligado quando o diagnóstico passa.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={load} title="Refrescar diagnóstico">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Switch
              checked={state.package_tracking_enabled}
              disabled={busy}
              onCheckedChange={onTogglePkg}
            />
          </div>
        </div>
        {pkgDiag && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Diag label="Tem templates" ok={!!pkgDiag.has_template} />
            <Diag label="Quant × Packages OK" ok={!blockers.some((x) => x.code === "quant_vs_package_divergence")} />
            <Diag label="Sem damaged/quarantine" ok={!blockers.some((x) => x.code === "damaged_or_quarantine_available")} />
            <Diag label="Packages com localização" ok={!blockers.some((x) => x.code === "package_without_location")} />
          </div>
        )}
        {blockers.length > 0 && (
          <div className="text-xs text-destructive flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
            <span>Blockers: {blockers.map((x) => x.code).join(", ")}</span>
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-3">
        <div className="o-section-title flex items-center gap-2">
          Diagnóstico de fabrico
          {mfgReady ? <Badge>Pronto</Badge> : <Badge variant="outline">Não pronto</Badge>}
        </div>
        {mfgBlockers.length === 0 && mfgWarnings.length === 0 && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Sem blockers nem warnings.
          </div>
        )}
        {mfgBlockers.map((b, i) => (
          <div key={`b-${i}`} className="text-xs text-destructive flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
            <span><strong>{b.code}</strong>{b.message ? ` — ${b.message}` : ""}</span>
          </div>
        ))}
        {mfgWarnings.map((w, i) => (
          <div key={`w-${i}`} className="text-xs text-amber-600 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 mt-0.5" />
            <span><strong>{w.code}</strong>{w.message ? ` — ${w.message}` : ""}</span>
          </div>
        ))}
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>Salvar configuração operacional</Button>
      </div>
    </div>
  );
}

function Diag({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
      <span>{label}</span>
    </div>
  );
}
