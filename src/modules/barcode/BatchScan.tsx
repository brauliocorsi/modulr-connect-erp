import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useScanner } from "./useScanner";
import { ScanInput, HistoryPanel, ScanLayout } from "./BarcodeUI";
import { CheckCircle2, X, Package } from "lucide-react";

type AggMove = {
  product_id: string;
  name: string;
  barcode: string | null;
  internal_ref: string | null;
  demand: number;
  done: number;
  moves: { id: string; quantity: number; quantity_done: number | null }[];
};

export default function BatchScan() {
  const [batch, setBatch] = useState<any>(null);
  const [agg, setAgg] = useState<AggMove[]>([]);
  const [pending, setPending] = useState<any[]>([]);

  const loadPending = async () => {
    const { data } = await supabase
      .from("stock_picking_batches")
      .select("id,name,state")
      .in("state", ["draft", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(20);
    setPending(data ?? []);
  };
  useEffect(() => { loadPending(); }, []);

  const openBatch = async (id: string) => {
    const { data: b } = await supabase.from("stock_picking_batches").select("*").eq("id", id).maybeSingle();
    if (!b) return;
    setBatch(b);
    const { data: ps } = await supabase.from("stock_pickings").select("id").eq("batch_id", id);
    const ids = (ps ?? []).map((p: any) => p.id);
    if (!ids.length) return setAgg([]);
    const { data: ms } = await supabase
      .from("stock_moves")
      .select("id,product_id,quantity,quantity_done,products(name,barcode,internal_ref)")
      .in("picking_id", ids);
    const map = new Map<string, AggMove>();
    (ms ?? []).forEach((m: any) => {
      const k = m.product_id;
      if (!map.has(k)) map.set(k, { product_id: k, name: m.products?.name, barcode: m.products?.barcode, internal_ref: m.products?.internal_ref, demand: 0, done: 0, moves: [] });
      const a = map.get(k)!;
      a.demand += Number(m.quantity || 0);
      a.done += Number(m.quantity_done || 0);
      a.moves.push({ id: m.id, quantity: Number(m.quantity), quantity_done: m.quantity_done });
    });
    setAgg(Array.from(map.values()));
  };

  const handleScan = async (raw: string) => {
    const v = raw.trim();
    const u = v.toUpperCase();
    if (u === "ESC" || u === "CANCEL") { setBatch(null); setAgg([]); return log("Lote fechado", "info"); }
    if (!batch) {
      const { data: b } = await supabase.from("stock_picking_batches").select("id,name,state").ilike("name", v).maybeSingle();
      if (!b) return log(`Lote "${v}" não encontrado`, "error");
      if (b.state === "done" || b.state === "cancelled") return log(`Lote ${b.name} já está ${b.state}`, "warn");
      await openBatch(b.id);
      return log(`Lote ${b.name} aberto`, "ok");
    }
    if (u === "OK" || u === "VALIDAR") return validate();
    // Find product across the batch
    const target = agg.find((a) => a.barcode === v) || agg.find((a) => a.internal_ref === v) || agg.find((a) => a.name.toLowerCase() === v.toLowerCase());
    if (!target) return log(`"${v}" não pertence ao lote`, "error");
    if (target.done >= target.demand) return log(`${target.name}: já completo (${target.demand}/${target.demand})`, "warn");
    // Find first move with capacity
    const move = target.moves.find((m) => Number(m.quantity_done ?? 0) < Number(m.quantity));
    if (!move) return log(`${target.name}: sem capacidade`, "warn");
    const next = Number(move.quantity_done ?? 0) + 1;
    const { error } = await supabase.from("stock_moves").update({ quantity_done: next }).eq("id", move.id);
    if (error) return log(error.message, "error");
    move.quantity_done = next;
    target.done += 1;
    setAgg([...agg]);
    log(`+1 ${target.name} (${target.done}/${target.demand})`, "ok");
  };

  const { code, setCode, inputRef, submit, log, history, flash } = useScanner(handleScan);

  const validate = async () => {
    if (!batch) return;
    if (batch.state === "done" || batch.state === "cancelled") return log("Lote já validado/cancelado", "warn");
    const { data, error } = await supabase.rpc("validate_batch", { _batch: batch.id });
    if (error) return log(error.message, "error");
    const r = (data as any) ?? {};
    if ((r.failed ?? 0) > 0) log(`${r.validated} validadas, ${r.failed} com erro`, "warn");
    else log(`✓ Lote validado (${r.validated} transferências)`, "ok");
    setBatch(null); setAgg([]); loadPending();
  };

  const totDemand = agg.reduce((s, a) => s + a.demand, 0);
  const totDone = agg.reduce((s, a) => s + a.done, 0);

  return (
    <ScanLayout
      title="Lote (Batch)"
      subtitle={batch ? `${batch.name}` : "Bipe o código de um lote"}
      actions={batch && batch.state !== "done" && batch.state !== "cancelled" ? (
        <>
          <button onClick={() => { setBatch(null); setAgg([]); }} className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-sm"><X className="inline h-4 w-4 mr-1" />Fechar</button>
          <button onClick={validate} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold"><CheckCircle2 className="inline h-4 w-4 mr-1" />Validar lote</button>
        </>
      ) : null}
    >
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <ScanInput inputRef={inputRef} code={code} setCode={setCode} onSubmit={() => submit()} placeholder={batch ? "Bipe produto, OK ou ESC" : "Bipe o código do lote (ex.: BATCH/00001)"} flash={flash} />
          {batch ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <span className="text-sm text-slate-300">Agregado de produtos do lote</span>
                <span className="text-sm font-bold">{totDone} / {totDemand}</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-800/50 text-xs uppercase tracking-wider text-slate-400">
                  <tr><th className="text-left px-3 py-2">Produto</th><th className="text-left px-3 py-2 w-32">Código</th><th className="text-left px-3 py-2 w-28">Feito / Total</th></tr>
                </thead>
                <tbody>
                  {agg.map((a) => {
                    const full = a.done >= a.demand;
                    return (
                      <tr key={a.product_id} className={`border-t border-slate-800 ${full ? "bg-emerald-950/40" : ""}`}>
                        <td className="px-3 py-2 flex items-center gap-2"><Package className="h-4 w-4 text-slate-500" />{a.name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">{a.barcode ?? a.internal_ref ?? "—"}</td>
                        <td className="px-3 py-2 font-bold"><span className={full ? "text-emerald-300" : ""}>{a.done}</span><span className="text-slate-500"> / {a.demand}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">Lotes pendentes</div>
              <ul>
                {pending.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => openBatch(p.id)} className="w-full text-left px-4 py-3 hover:bg-slate-800 border-b border-slate-800 flex items-center justify-between">
                      <div className="font-mono">{p.name}</div>
                      <span className="text-xs px-2 py-1 rounded bg-slate-800">{p.state}</span>
                    </button>
                  </li>
                ))}
                {pending.length === 0 && <li className="px-4 py-6 text-center text-slate-500 text-sm">Sem lotes pendentes</li>}
              </ul>
            </div>
          )}
        </div>
        <HistoryPanel history={history} />
      </div>
    </ScanLayout>
  );
}
