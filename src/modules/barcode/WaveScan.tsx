import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useScanner } from "./useScanner";
import { ScanInput, HistoryPanel, ScanLayout } from "./BarcodeUI";
import { CheckCircle2, X, Package } from "lucide-react";

export default function WaveScan() {
  const [wave, setWave] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);

  const loadPending = async () => {
    const { data } = await supabase.from("stock_picking_waves").select("id,name,state").in("state", ["draft", "in_progress"]).order("created_at", { ascending: false }).limit(20);
    setPending(data ?? []);
  };
  useEffect(() => { loadPending(); }, []);

  const openWave = async (id: string) => {
    const { data: w } = await supabase.from("stock_picking_waves").select("*").eq("id", id).maybeSingle();
    if (!w) return;
    setWave(w);
    const { data: ms } = await supabase
      .from("stock_moves")
      .select("id,product_id,quantity,quantity_done,products(name,barcode,internal_ref),stock_pickings(name)")
      .eq("wave_id", id);
    setMoves(ms ?? []);
  };

  const handleScan = async (raw: string) => {
    const v = raw.trim(); const u = v.toUpperCase();
    if (u === "ESC" || u === "CANCEL") { setWave(null); setMoves([]); return log("Onda fechada", "info"); }
    if (!wave) {
      const { data: w } = await supabase.from("stock_picking_waves").select("id,name,state").ilike("name", v).maybeSingle();
      if (!w) return log(`Onda "${v}" não encontrada`, "error");
      if (w.state === "done" || w.state === "cancelled") return log(`Onda ${w.name} já está ${w.state}`, "warn");
      await openWave(w.id);
      return log(`Onda ${w.name} aberta`, "ok");
    }
    if (u === "OK" || u === "VALIDAR") return validate();
    const target = moves.find((m: any) => m.products?.barcode === v) || moves.find((m: any) => m.products?.internal_ref === v) || moves.find((m: any) => m.products?.name?.toLowerCase() === v.toLowerCase());
    if (!target) return log(`"${v}" não está na onda`, "error");
    const cur = Number(target.quantity_done ?? 0);
    const max = Number(target.quantity);
    if (cur >= max) return log(`${target.products?.name}: completo`, "warn");
    const next = cur + 1;
    const { error } = await supabase.from("stock_moves").update({ quantity_done: next }).eq("id", target.id);
    if (error) return log(error.message, "error");
    setMoves((ms) => ms.map((m) => (m.id === target.id ? { ...m, quantity_done: next } : m)));
    log(`+1 ${target.products?.name} (${next}/${max})`, "ok");
  };

  const { code, setCode, inputRef, submit, log, history, flash } = useScanner(handleScan);

  const validate = async () => {
    if (!wave) return;
    const { error } = await supabase.rpc("validate_wave", { _wave: wave.id });
    if (error) return log(error.message, "error");
    log(`✓ Onda ${wave.name} validada`, "ok");
    setWave(null); setMoves([]); loadPending();
  };

  const totDone = moves.reduce((s, m) => s + Number(m.quantity_done ?? 0), 0);
  const totDemand = moves.reduce((s, m) => s + Number(m.quantity), 0);

  return (
    <ScanLayout
      title="Onda (Wave)"
      subtitle={wave ? wave.name : "Bipe o código de uma onda"}
      actions={wave && wave.state !== "done" && wave.state !== "cancelled" ? (
        <>
          <button onClick={() => { setWave(null); setMoves([]); }} className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-sm"><X className="inline h-4 w-4 mr-1" />Fechar</button>
          <button onClick={validate} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold"><CheckCircle2 className="inline h-4 w-4 mr-1" />Validar onda</button>
        </>
      ) : null}
    >
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <ScanInput inputRef={inputRef} code={code} setCode={setCode} onSubmit={() => submit()} placeholder={wave ? "Bipe produto, OK ou ESC" : "Bipe o código da onda (ex.: WAVE/00001)"} flash={flash} />
          {wave ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <span className="text-sm text-slate-300">Movimentos da onda</span>
                <span className="text-sm font-bold">{totDone} / {totDemand}</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-800/50 text-xs uppercase tracking-wider text-slate-400">
                  <tr><th className="text-left px-3 py-2">Produto</th><th className="text-left px-3 py-2">Transferência</th><th className="text-left px-3 py-2 w-28">Feito / Pedido</th></tr>
                </thead>
                <tbody>
                  {moves.map((m: any) => {
                    const cur = Number(m.quantity_done ?? 0); const need = Number(m.quantity); const full = cur >= need;
                    return (
                      <tr key={m.id} className={`border-t border-slate-800 ${full ? "bg-emerald-950/40" : ""}`}>
                        <td className="px-3 py-2 flex items-center gap-2"><Package className="h-4 w-4 text-slate-500" />{m.products?.name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">{m.stock_pickings?.name}</td>
                        <td className="px-3 py-2 font-bold"><span className={full ? "text-emerald-300" : ""}>{cur}</span><span className="text-slate-500"> / {need}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">Ondas pendentes</div>
              <ul>
                {pending.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => openWave(p.id)} className="w-full text-left px-4 py-3 hover:bg-slate-800 border-b border-slate-800 flex items-center justify-between">
                      <div className="font-mono">{p.name}</div><span className="text-xs px-2 py-1 rounded bg-slate-800">{p.state}</span>
                    </button>
                  </li>
                ))}
                {pending.length === 0 && <li className="px-4 py-6 text-center text-slate-500 text-sm">Sem ondas pendentes</li>}
              </ul>
            </div>
          )}
        </div>
        <HistoryPanel history={history} />
      </div>
    </ScanLayout>
  );
}
