import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useScanner } from "./useScanner";
import { ScanInput, HistoryPanel, ScanLayout } from "./BarcodeUI";
import { MapPin } from "lucide-react";

export default function LocationLookup() {
  const [loc, setLoc] = useState<any>(null);
  const [quants, setQuants] = useState<any[]>([]);

  const handleScan = async (raw: string) => {
    const v = raw.trim();
    const { data: l } = await supabase
      .from("stock_locations")
      .select("id,name,full_path,type")
      .or(`name.eq.${v},full_path.eq.${v}`)
      .maybeSingle();
    if (!l) { setLoc(null); setQuants([]); return log(`Local "${v}" não encontrado`, "error"); }
    setLoc(l);
    const { data: qs } = await supabase
      .from("stock_quants")
      .select("quantity,reserved_quantity,products(name,internal_ref,barcode)")
      .eq("location_id", l.id);
    setQuants(qs ?? []);
    log(`${l.full_path ?? l.name}: ${qs?.length ?? 0} quants`, "ok");
  };

  const { code, setCode, inputRef, submit, log, history, flash } = useScanner(handleScan);

  return (
    <ScanLayout title="Consultar localização" subtitle="Bipe um local para ver o seu conteúdo">
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <ScanInput inputRef={inputRef} code={code} setCode={setCode} onSubmit={() => submit()} placeholder="Bipe nome ou caminho do local (ex.: WH/Stock)" flash={flash} />
          {loc && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">Local</div>
              <div className="text-2xl font-bold flex items-center gap-2"><MapPin className="h-6 w-6 text-fuchsia-400" />{loc.full_path ?? loc.name}</div>
            </div>
          )}
          {loc && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">Conteúdo</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-800/50 text-xs uppercase tracking-wider text-slate-400">
                  <tr><th className="text-left px-3 py-2">Produto</th><th className="text-left px-3 py-2 w-32">Código</th><th className="text-left px-3 py-2 w-24">Qtd</th><th className="text-left px-3 py-2 w-24">Reservado</th></tr>
                </thead>
                <tbody>
                  {quants.map((q, i) => (
                    <tr key={i} className="border-t border-slate-800">
                      <td className="px-3 py-2">{q.products?.name}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">{q.products?.barcode ?? q.products?.internal_ref ?? "—"}</td>
                      <td className="px-3 py-2 font-bold">{q.quantity}</td>
                      <td className="px-3 py-2 text-amber-300">{q.reserved_quantity}</td>
                    </tr>
                  ))}
                  {quants.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">Local vazio</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <HistoryPanel history={history} />
      </div>
    </ScanLayout>
  );
}
