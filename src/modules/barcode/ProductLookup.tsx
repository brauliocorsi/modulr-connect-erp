import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useScanner } from "./useScanner";
import { ScanInput, HistoryPanel, ScanLayout } from "./BarcodeUI";
import { Package } from "lucide-react";

export default function ProductLookup() {
  const [product, setProduct] = useState<any>(null);
  const [quants, setQuants] = useState<any[]>([]);

  const handleScan = async (raw: string) => {
    const v = raw.trim();
    const { data: p } = await supabase
      .from("products")
      .select("id,name,internal_ref,barcode,sale_price,cost_price")
      .or(`barcode.eq.${v},internal_ref.eq.${v}`)
      .maybeSingle();
    if (!p) {
      setProduct(null); setQuants([]);
      return log(`Produto "${v}" não encontrado`, "error");
    }
    setProduct(p);
    const { data: qs } = await supabase
      .from("stock_quants")
      .select("quantity,reserved_quantity,stock_locations(name,full_path)")
      .eq("product_id", p.id);
    setQuants(qs ?? []);
    log(`${p.name} carregado`, "ok");
  };

  const { code, setCode, inputRef, submit, log, history, flash } = useScanner(handleScan);
  const total = quants.reduce((s, q) => s + Number(q.quantity || 0), 0);
  const reserved = quants.reduce((s, q) => s + Number(q.reserved_quantity || 0), 0);

  return (
    <ScanLayout title="Consultar produto" subtitle="Bipe um produto para ver stock por localização">
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <ScanInput inputRef={inputRef} code={code} setCode={setCode} onSubmit={() => submit()} placeholder="Bipe código de barras ou referência interna" flash={flash} />
          {product && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">Produto</div>
                  <div className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6 text-emerald-400" />{product.name}</div>
                  <div className="text-xs text-slate-400 font-mono mt-1">{product.barcode ?? product.internal_ref}</div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-emerald-300">{total}</div>
                  <div className="text-xs text-slate-400">Stock total · {reserved} reservado</div>
                </div>
              </div>
            </div>
          )}
          {product && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">Stock por localização</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-800/50 text-xs uppercase tracking-wider text-slate-400">
                  <tr><th className="text-left px-3 py-2">Localização</th><th className="text-left px-3 py-2 w-28">Quantidade</th><th className="text-left px-3 py-2 w-28">Reservado</th><th className="text-left px-3 py-2 w-28">Disponível</th></tr>
                </thead>
                <tbody>
                  {quants.map((q, i) => {
                    const avail = Number(q.quantity || 0) - Number(q.reserved_quantity || 0);
                    return (
                      <tr key={i} className="border-t border-slate-800">
                        <td className="px-3 py-2">{q.stock_locations?.full_path ?? q.stock_locations?.name}</td>
                        <td className="px-3 py-2 font-bold">{q.quantity}</td>
                        <td className="px-3 py-2 text-amber-300">{q.reserved_quantity}</td>
                        <td className="px-3 py-2 text-emerald-300">{avail}</td>
                      </tr>
                    );
                  })}
                  {quants.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">Sem stock</td></tr>}
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
