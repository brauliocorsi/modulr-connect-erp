import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";

export function PackageTrackingToggle({ productId }: { productId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [diag, setDiag] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const loadAll = async () => {
    const [{ data: p }, { data: d }] = await Promise.all([
      supabase.from("products").select("package_tracking_enabled").eq("id", productId).maybeSingle(),
      supabase.rpc("package_tracking_diagnostic", { _product_id: productId }),
    ]);
    setEnabled(!!(p as any)?.package_tracking_enabled);
    setDiag(d as any);
  };
  useEffect(() => { loadAll(); }, [productId]);

  const onToggle = async (next: boolean) => {
    if (next) {
      setBusy(true);
      const { data: d, error } = await supabase.rpc("package_tracking_diagnostic", { _product_id: productId });
      if (error) { setBusy(false); return toast.error(error.message); }
      const diagnostic: any = d;
      setDiag(diagnostic);
      if (!diagnostic?.ready_for_activation) {
        setBusy(false);
        const codes = (diagnostic?.blockers ?? []).map((b: any) => b.code).join(", ") || "missing_template";
        return toast.error(`Não pronto para ativar: ${codes}`);
      }
    }
    setBusy(true);
    const { error } = await supabase.rpc("update_product_operational_config", {
      _product_id: productId,
      _supply_route: null as any,
      _allocation_policy: null as any,
      _component_allocation_policy: null as any,
      _package_tracking_enabled: next,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setEnabled(next);
    toast.success(next ? "Package tracking ativado para este produto" : "Package tracking desativado");
    loadAll();
  };

  const b = diag?.blockers ?? [];
  const ready = !!diag?.ready_for_activation;

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold flex items-center gap-2">
            Package tracking por produto
            {enabled ? <Badge>ON</Badge> : <Badge variant="outline">OFF</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Ativa o rastreio físico colis-a-colis para este produto. Só pode ser ativado quando o diagnóstico passa.
            Não altera a flag global.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={loadAll} title="Refrescar diagnóstico"><RefreshCw className="h-4 w-4" /></Button>
          <Switch checked={enabled} disabled={busy || (!enabled && !ready)} onCheckedChange={onToggle} />
        </div>
      </div>
      {diag && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Diag label="Tem templates" ok={!!diag.has_template} />
          <Diag label="Quant × Packages OK" ok={!b.some((x: any) => x.code === "quant_vs_package_divergence")} />
          <Diag label="Sem damaged/quarantine" ok={!b.some((x: any) => x.code === "damaged_or_quarantine_available")} />
          <Diag label="Packages com localização" ok={!b.some((x: any) => x.code === "package_without_location")} />
        </div>
      )}
      {diag && b.length > 0 && (
        <div className="text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
          <span>Blockers: {b.map((x: any) => x.code).join(", ")}</span>
        </div>
      )}
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
