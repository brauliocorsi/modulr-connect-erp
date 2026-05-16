import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Wallet, Lock } from "lucide-react";
import { callM5Rpc } from "../lib/m5Rpc";

interface Props {
  routeId: string;
  routeState: string;
  onClosed?: () => void;
}

type Summary = {
  ok: boolean;
  expected_cash: number;
  expected_mbway: number;
  expected_multibanco: number;
  expected_transfer: number;
  expected_other: number;
  total_expected: number;
  closure_existing: any | null;
  payments: Array<{ payment_id: string; amount: number; method: string }>;
};

// UI M5 — Cash closure card. Apenas chama RPCs oficiais.
// SEM updates diretos em cash_movements, customer_payments ou delivery_route_cash_closure.
export function CashClosureCard({ routeId, routeState, onClosed }: Props) {
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["route-cash-summary", routeId],
    enabled: !!routeId,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("delivery_route_cash_summary", { _route_id: routeId });
      return data as Summary;
    },
  });

  const [actuals, setActuals] = useState({ cash: "", mbway: "", multibanco: "", transfer: "", other: "" });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const closure = data?.closure_existing as any;
  const isClosed = !!closure?.closed_at;

  async function submit() {
    setBusy(true);
    const res = await callM5Rpc(
      "delivery_route_cash_close",
      {
        _route_id: routeId,
        _actuals: {
          actual_cash: Number(actuals.cash || 0),
          actual_mbway: Number(actuals.mbway || 0),
          actual_multibanco: Number(actuals.multibanco || 0),
          actual_transfer: Number(actuals.transfer || 0),
          actual_other: Number(actuals.other || 0),
        },
        _notes: notes || null,
      },
      "Fechar caixa da rota",
    );
    setBusy(false);
    if (res.ok) {
      refetch();
      onClosed?.();
    }
  }

  if (isLoading) return <Card className="p-3 text-sm text-muted-foreground">A carregar caixa…</Card>;
  if (!data?.ok) return <Card className="p-3 text-sm text-rose-700">Não foi possível obter o resumo de caixa.</Card>;

  const noPayments = data.total_expected === 0;

  return (
    <Card className="p-3 space-y-3" data-testid="cash-closure-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-sm"><Wallet className="h-4 w-4" /> Caixa da rota</div>
        {isClosed ? (
          <span className="text-[11px] flex items-center gap-1 text-emerald-700"><Lock className="h-3 w-3" />Fechada</span>
        ) : (
          <span className="text-[11px] text-amber-700">Pendente</span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
        {([
          ["Dinheiro", data.expected_cash, "cash"],
          ["MBway", data.expected_mbway, "mbway"],
          ["Multibanco", data.expected_multibanco, "multibanco"],
          ["Transferência", data.expected_transfer, "transfer"],
          ["Outro", data.expected_other, "other"],
        ] as const).map(([label, exp, key]) => (
          <div key={key} className="rounded bg-muted/30 p-2">
            <div className="text-muted-foreground">{label}</div>
            <div className="tabular-nums font-medium">€ {Number(exp).toFixed(2)}</div>
            {!isClosed && exp > 0 && (
              <Input
                className="h-7 mt-1 text-xs"
                placeholder="real"
                inputMode="decimal"
                value={actuals[key as keyof typeof actuals]}
                onChange={(e) => setActuals((s) => ({ ...s, [key]: e.target.value }))}
                aria-label={`actual-${key}`}
              />
            )}
            {isClosed && (
              <div className="text-[10px] text-muted-foreground mt-1">
                real: € {Number(closure?.[`actual_${key}`] ?? 0).toFixed(2)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="text-xs">
        Total esperado: <span className="font-semibold tabular-nums">€ {data.total_expected.toFixed(2)}</span>
        {isClosed && (
          <span className="ml-3">
            Variance: <span className={`tabular-nums font-semibold ${Number(closure.variance) === 0 ? "text-emerald-700" : "text-rose-700"}`}>
              € {Number(closure.variance).toFixed(2)}
            </span>
          </span>
        )}
      </div>

      {noPayments && !isClosed && (
        <div className="text-[11px] text-muted-foreground rounded border bg-muted/20 px-2 py-1.5">
          Sem pagamentos — feche com zeros para libertar o fecho da rota, ou avance directamente para `delivery_route_close` se a regra permitir.
        </div>
      )}

      {!isClosed && (
        <>
          <div>
            <Label className="text-xs">Notas</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-xs" />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={busy} data-testid="cash-close-btn">
              {busy ? "A fechar…" : "Fechar caixa"}
            </Button>
          </div>
        </>
      )}

      {data.payments.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-muted-foreground">Pagamentos ({data.payments.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {data.payments.map((p) => (
              <li key={p.payment_id} className="flex justify-between"><span>{p.method}</span><span>€ {Number(p.amount).toFixed(2)}</span></li>
            ))}
          </ul>
        </details>
      )}

      <div className="text-[10px] text-muted-foreground">Estado da rota: {routeState}</div>
    </Card>
  );
}
