import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, PlayCircle, CheckCircle2, XCircle, ArrowRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";

type Step = {
  key: string;
  title: string;
  status: "ok" | "skip" | "error";
  detail?: string;
  link?: { label: string; to: string };
  ms?: number;
};

type Opt = { id: string; name: string; warehouse_id?: string; license_plate?: string; sku?: string };
type Options = {
  warehouses: Opt[];
  locations: (Opt & { warehouse_id: string })[];
  products: Opt[];
  customers: Opt[];
  suppliers: Opt[];
  vehicles: Opt[];
  payment_methods: Opt[];
};

const PIPELINE = [
  "Compra", "Receção", "Stock", "Venda", "Pagamento",
  "Saída", "Cais", "Carrinha", "Lote", "Entrega",
];

export default function DemoFlowPage() {
  const [mode, setMode] = useState<"full_on_sale" | "split_50_50">("full_on_sale");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<Options | null>(null);
  const [loadingOpts, setLoadingOpts] = useState(true);

  // form state
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [stockLocId, setStockLocId] = useState<string>("");
  const [dockLocId, setDockLocId] = useState<string>("");
  const [vehicleLocId, setVehicleLocId] = useState<string>("");
  const [productId, setProductId] = useState<string>("");
  const [customerId, setCustomerId] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [vehicleId, setVehicleId] = useState<string>("");
  const [methodId, setMethodId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [unitPrice, setUnitPrice] = useState<number>(200);
  const [unitCost, setUnitCost] = useState<number>(80);

  useEffect(() => {
    (async () => {
      setLoadingOpts(true);
      const { data, error } = await supabase.functions.invoke("demo-flow", { body: { mode: "list_options" } });
      if (error) { toast.error(error.message); setLoadingOpts(false); return; }
      const o = data as Options;
      setOpts(o);
      // defaults
      const wh = o.warehouses[0];
      if (wh) {
        setWarehouseId(wh.id);
        const wlocs = o.locations.filter(l => l.warehouse_id === wh.id);
        setStockLocId(wlocs.find(l => l.name === "Stock")?.id ?? "");
        setDockLocId(wlocs.find(l => l.name === "Cais de Carga")?.id ?? "");
        setVehicleLocId(wlocs.find(l => l.name === "Zona Carrinha")?.id ?? "");
      }
      setProductId(o.products[0]?.id ?? "");
      setCustomerId(o.customers[0]?.id ?? "");
      setSupplierId(o.suppliers[0]?.id ?? "");
      setVehicleId(o.vehicles[0]?.id ?? "");
      setMethodId(o.payment_methods.find(m => (m as any).code === "CASH")?.id ?? o.payment_methods[0]?.id ?? "");
      setLoadingOpts(false);
    })();
  }, []);

  const whLocations = useMemo(
    () => (opts?.locations ?? []).filter(l => l.warehouse_id === warehouseId),
    [opts, warehouseId],
  );

  const onChangeWarehouse = (id: string) => {
    setWarehouseId(id);
    const wlocs = (opts?.locations ?? []).filter(l => l.warehouse_id === id);
    setStockLocId(wlocs.find(l => l.name === "Stock")?.id ?? wlocs[0]?.id ?? "");
    setDockLocId(wlocs.find(l => l.name === "Cais de Carga")?.id ?? "");
    setVehicleLocId(wlocs.find(l => l.name === "Zona Carrinha")?.id ?? "");
  };

  const run = async () => {
    setRunning(true);
    setSteps([]);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("demo-flow", {
        body: {
          payment_mode: mode,
          warehouse_id: warehouseId || undefined,
          stock_location_id: stockLocId || undefined,
          dock_location_id: dockLocId || undefined,
          vehicle_location_id: vehicleLocId || undefined,
          product_id: productId || undefined,
          customer_id: customerId || undefined,
          supplier_id: supplierId || undefined,
          vehicle_id: vehicleId || undefined,
          method_id: methodId || undefined,
          quantity,
          unit_price: unitPrice,
          unit_cost: unitCost,
        },
      });
      if (error) throw error;
      setSteps(data?.steps ?? []);
      if (!data?.ok) {
        setError(data?.error ?? "Erro desconhecido");
        toast.error("Fluxo falhou — vê o detalhe abaixo");
      } else {
        toast.success("Fluxo end-to-end concluído!");
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      toast.error(e?.message ?? "Erro");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Demo end-to-end</h1>
        <p className="text-sm text-muted-foreground">
          Escolhe os parâmetros e simula o ciclo completo: <b>Compra → Receção → Venda → Pagamento → Cais → Carrinha → Entrega</b>.
        </p>
      </div>

      {/* Pipeline visual */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {PIPELINE.map((p, i) => {
          const done = steps.length > i;
          return (
            <div key={p} className="flex items-center gap-2">
              <Badge variant={done ? "default" : "outline"} className={done ? "bg-emerald-500 hover:bg-emerald-600" : ""}>
                {p}
              </Badge>
              {i < PIPELINE.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
            </div>
          );
        })}
      </div>

      {/* Configuração */}
      <Card className="p-4 space-y-4">
        <div className="font-semibold">Parâmetros do fluxo</div>
        {loadingOpts ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> A carregar opções…
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Produto">
              <SelectBox value={productId} onChange={setProductId} options={opts!.products.map(p => ({ value: p.id, label: p.sku ? `${p.name} (${p.sku})` : p.name }))} />
            </Field>
            <Field label="Quantidade">
              <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="Preço unitário (venda)">
              <Input type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value) || 0)} />
            </Field>
            <Field label="Custo unitário (compra)">
              <Input type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value) || 0)} />
            </Field>
            <Field label="Cliente">
              <SelectBox value={customerId} onChange={setCustomerId} options={opts!.customers.map(p => ({ value: p.id, label: p.name }))} />
            </Field>
            <Field label="Fornecedor">
              <SelectBox value={supplierId} onChange={setSupplierId} options={opts!.suppliers.map(p => ({ value: p.id, label: p.name }))} />
            </Field>
            <Field label="Armazém">
              <SelectBox value={warehouseId} onChange={onChangeWarehouse} options={opts!.warehouses.map(p => ({ value: p.id, label: p.name }))} />
            </Field>
            <Field label="Localização Stock">
              <SelectBox value={stockLocId} onChange={setStockLocId} options={whLocations.map(p => ({ value: p.id, label: p.name }))} />
            </Field>
            <Field label="Cais de Carga">
              <SelectBox value={dockLocId} onChange={setDockLocId} options={whLocations.map(p => ({ value: p.id, label: p.name }))} />
            </Field>
            <Field label="Zona Carrinha">
              <SelectBox value={vehicleLocId} onChange={setVehicleLocId} options={whLocations.map(p => ({ value: p.id, label: p.name }))} />
            </Field>
            <Field label="Carrinha">
              <SelectBox value={vehicleId} onChange={setVehicleId} options={opts!.vehicles.map(p => ({ value: p.id, label: p.license_plate ? `${p.name} (${p.license_plate})` : p.name }))} />
            </Field>
            <Field label="Método de pagamento">
              <SelectBox value={methodId} onChange={setMethodId} options={opts!.payment_methods.map(p => ({ value: p.id, label: p.name }))} />
            </Field>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
          <span className="text-sm font-medium">Modo de pagamento:</span>
          <Button size="sm" variant={mode === "full_on_sale" ? "default" : "outline"} onClick={() => setMode("full_on_sale")} disabled={running}>
            100% no caixa
          </Button>
          <Button size="sm" variant={mode === "split_50_50" ? "default" : "outline"} onClick={() => setMode("split_50_50")} disabled={running}>
            50% caixa + 50% entrega
          </Button>
        </div>

        <div className="flex gap-2">
          <Button onClick={run} disabled={running || loadingOpts} size="lg" className="bg-emerald-500 hover:bg-emerald-600">
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
            {running ? "A executar…" : "Run fluxo completo"}
          </Button>
          {steps.length > 0 && !running && (
            <Button variant="outline" size="lg" onClick={run}>
              <RotateCcw className="h-4 w-4 mr-2" /> Correr outra vez
            </Button>
          )}
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-destructive bg-destructive/5">
          <div className="flex items-start gap-2">
            <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-destructive">Erro</div>
              <div className="text-sm">{error}</div>
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {steps.map((s, i) => (
          <Card key={i} className={`p-3 ${s.status === "error" ? "border-destructive bg-destructive/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
            <div className="flex items-start gap-3">
              {s.status === "error"
                ? <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                : <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-medium">{s.title}</div>
                  {s.ms != null && <span className="text-xs text-muted-foreground tabular-nums">{s.ms}ms</span>}
                </div>
                {s.detail && <div className="text-sm text-muted-foreground mt-0.5">{s.detail}</div>}
                {s.link && (
                  <Link to={s.link.to} className="inline-flex items-center gap-1 text-sm text-emerald-600 hover:underline mt-1">
                    {s.link.label} <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function SelectBox({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Seleciona…" /></SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
