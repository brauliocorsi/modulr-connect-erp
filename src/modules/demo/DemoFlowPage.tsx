import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

const PIPELINE = [
  "Compra", "Receção", "Stock", "Venda", "Pagamento",
  "Saída", "Cais", "Carrinha", "Lote", "Entrega",
];

export default function DemoFlowPage() {
  const [mode, setMode] = useState<"full_on_sale" | "split_50_50">("full_on_sale");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setSteps([]);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("demo-flow", {
        body: { payment_mode: mode },
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
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Demo end-to-end</h1>
        <p className="text-sm text-muted-foreground">
          Simula o ciclo completo: <b>Compra → Receção → Venda → Pagamento → Cais → Carrinha → Entrega</b>.
          Cria dados reais no backend.
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

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Modo de pagamento:</span>
          <Button
            size="sm"
            variant={mode === "full_on_sale" ? "default" : "outline"}
            onClick={() => setMode("full_on_sale")}
            disabled={running}
          >
            100% no caixa da venda
          </Button>
          <Button
            size="sm"
            variant={mode === "split_50_50" ? "default" : "outline"}
            onClick={() => setMode("split_50_50")}
            disabled={running}
          >
            50% caixa + 50% entrega
          </Button>
        </div>

        <div className="flex gap-2">
          <Button onClick={run} disabled={running} size="lg" className="bg-emerald-500 hover:bg-emerald-600">
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

      {steps.length === 0 && !running && (
        <div className="text-center text-sm text-muted-foreground py-8">
          Carrega em <b>Run</b> para executar o fluxo. Vais ver cada etapa com link para o ecrã correspondente.
        </div>
      )}
    </div>
  );
}
