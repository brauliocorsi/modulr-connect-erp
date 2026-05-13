import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useScanner } from "./useScanner";
import { ScanInput, HistoryPanel } from "./BarcodeUI";
import { MapPin, Package, Truck, ArrowRight, X, Plus, Minus } from "lucide-react";
import { toast } from "sonner";

type Loc = { id: string; name: string; full_path: string | null };
type Prod = { id: string; name: string; barcode: string | null; internal_ref: string | null; uom_id: string | null };
type Line = { product: Prod; qty: number };

export default function SmartScan() {
  const nav = useNavigate();
  const [source, setSource] = useState<Loc | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [locInfo, setLocInfo] = useState<{ loc: Loc; quants: any[] } | null>(null);
  const [prodInfo, setProdInfo] = useState<{ product: Prod; quants: any[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setSource(null); setLines([]); };

  const handleScan = async (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    const upper = v.toUpperCase();

    if (upper === "ESC" || upper === "CANCEL" || upper === "VOLTAR") {
      reset(); setLocInfo(null); setProdInfo(null);
      return log("Sessão limpa", "info");
    }
    if (upper === "OK" || upper === "VALIDAR" || upper === "VALIDATE") {
      if (source && lines.length) return log("Bipe o local de destino para concluir", "warn");
      return;
    }

    // 1) Picking?
    const { data: picking } = await supabase
      .from("stock_pickings")
      .select("id,name,state,kind")
      .ilike("name", v)
      .maybeSingle();
    if (picking) {
      if (picking.state === "done" || picking.state === "cancelled") {
        log(`Transferência ${picking.name} já está ${picking.state}`, "warn");
      } else {
        log(`A abrir ${picking.name}…`, "ok");
      }
      nav(`/barcode/op/all`, { state: { pickingId: picking.id } });
      return;
    }

    // 2) Location?
    const { data: loc } = await supabase
      .from("stock_locations")
      .select("id,name,full_path,type,barcode")
      .or(`barcode.eq.${v},name.eq.${v},full_path.eq.${v}`)
      .maybeSingle();
    if (loc) {
      // If we are mid-transfer with at least one line, this is destination
      if (source && lines.length) {
        if (loc.id === source.id) return log("Destino tem de ser diferente da origem", "error");
        await commitTransfer(loc as Loc);
        return;
      }
      // Else, set as source AND show its content
      setSource(loc as Loc);
      setLines([]);
      setProdInfo(null);
      const { data: qs } = await supabase
        .from("stock_quants")
        .select("quantity,reserved_quantity,products(name,internal_ref,barcode)")
        .eq("location_id", loc.id);
      setLocInfo({ loc: loc as Loc, quants: qs ?? [] });
      log(`Local ${loc.full_path ?? loc.name} — bipe um produto para iniciar transferência`, "ok");
      return;
    }

    // 3) Product?
    const { data: product } = await supabase
      .from("products")
      .select("id,name,barcode,internal_ref,uom_id")
      .or(`barcode.eq.${v},internal_ref.eq.${v}`)
      .maybeSingle();
    if (product) {
      // If source location set → add line (transfer mode)
      if (source) {
        setLines((ls) => {
          const idx = ls.findIndex((l) => l.product.id === product.id);
          if (idx >= 0) {
            const next = [...ls];
            next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
            return next;
          }
          return [...ls, { product: product as Prod, qty: 1 }];
        });
        log(`+ ${product.name} (bipe destino p/ concluir)`, "ok");
        return;
      }
      // Else just consult
      const { data: qs } = await supabase
        .from("stock_quants")
        .select("quantity,reserved_quantity,stock_locations(name,full_path)")
        .eq("product_id", product.id);
      setProdInfo({ product: product as Prod, quants: qs ?? [] });
      setLocInfo(null);
      log(`Produto ${product.name} consultado`, "ok");
      return;
    }

    log(`Código "${v}" não reconhecido`, "error");
  };

  const { code, setCode, inputRef, submit, log, history, flash } = useScanner(handleScan);

  const commitTransfer = async (dest: Loc) => {
    if (!source) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("create_internal_transfer", {
      _source: source.id,
      _destination: dest.id,
      _lines: lines.map((l) => ({ product_id: l.product.id, quantity: l.qty, uom_id: l.product.uom_id })) as any,
    });
    setBusy(false);
    if (error) { log(error.message, "error"); return; }
    toast.success("Transferência criada");
    log(`✓ Transferência ${source.full_path ?? source.name} → ${dest.full_path ?? dest.name}`, "ok");
    reset();
    if (data) nav(`/barcode/op/all`, { state: { pickingId: data as string } });
  };

  const total = (locInfo?.quants ?? []).reduce((s, q) => s + Number(q.quantity || 0), 0);
  const prodTotal = (prodInfo?.quants ?? []).reduce((s, q) => s + Number(q.quantity || 0), 0);

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4">
      <div className="space-y-4">
        <ScanInput
          inputRef={inputRef}
          code={code}
          setCode={setCode}
          onSubmit={() => submit()}
          placeholder={
            source && lines.length
              ? `Bipe LOCAL DESTINO para concluir transferência (${lines.length} linha(s))`
              : source
                ? `Origem: ${source.full_path ?? source.name} — bipe um PRODUTO`
                : "Bipe LOCAL, PRODUTO ou TRANSFERÊNCIA…"
          }
          flash={flash}
        />

        {/* Transfer in progress */}
        {source && (
          <div className="bg-slate-900 border border-indigo-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3 text-indigo-300 text-xs uppercase tracking-wider">
              <Truck className="h-4 w-4" /> Transferência em curso
              <button
                onClick={reset}
                className="ml-auto text-slate-400 hover:text-white inline-flex items-center gap-1 normal-case text-xs"
              >
                <X className="h-3 w-3" /> Cancelar
              </button>
            </div>
            <div className="flex items-center gap-2 text-sm mb-3">
              <MapPin className="h-4 w-4 text-fuchsia-400" />
              <span className="font-bold">{source.full_path ?? source.name}</span>
              <ArrowRight className="h-4 w-4 text-slate-500" />
              <span className="text-slate-400 italic">aguarda destino…</span>
            </div>
            {lines.length === 0 ? (
              <div className="text-slate-500 text-sm">Bipe um produto para adicionar à transferência.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-slate-400">
                  <tr><th className="text-left py-1">Produto</th><th className="w-32 text-right">Qtd</th><th className="w-20"></th></tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t border-slate-800">
                      <td className="py-2 flex items-center gap-2"><Package className="h-4 w-4 text-emerald-400" />{l.product.name}</td>
                      <td className="py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => setLines((ls) => ls.map((x, idx) => idx === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x))} className="p-1 rounded bg-slate-800 hover:bg-slate-700"><Minus className="h-3 w-3" /></button>
                          <span className="font-bold w-8 text-center">{l.qty}</span>
                          <button onClick={() => setLines((ls) => ls.map((x, idx) => idx === i ? { ...x, qty: x.qty + 1 } : x))} className="p-1 rounded bg-slate-800 hover:bg-slate-700"><Plus className="h-3 w-3" /></button>
                        </div>
                      </td>
                      <td className="py-2 text-right">
                        <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-rose-400 hover:text-rose-300 text-xs">Remover</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {busy && <div className="text-xs text-slate-400 mt-2">A criar transferência…</div>}
          </div>
        )}

        {/* Location info (when not consuming as source) */}
        {locInfo && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
              <MapPin className="h-5 w-5 text-fuchsia-400" />
              <span className="font-bold">{locInfo.loc.full_path ?? locInfo.loc.name}</span>
              <span className="ml-auto text-sm text-slate-400">{locInfo.quants.length} produto(s) · total {total}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-800/50 text-xs uppercase tracking-wider text-slate-400">
                <tr><th className="text-left px-3 py-2">Produto</th><th className="text-left px-3 py-2 w-32">Código</th><th className="text-left px-3 py-2 w-20">Qtd</th><th className="text-left px-3 py-2 w-20">Reserv.</th></tr>
              </thead>
              <tbody>
                {locInfo.quants.map((q, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="px-3 py-2">{q.products?.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{q.products?.barcode ?? q.products?.internal_ref ?? "—"}</td>
                    <td className="px-3 py-2 font-bold">{q.quantity}</td>
                    <td className="px-3 py-2 text-amber-300">{q.reserved_quantity}</td>
                  </tr>
                ))}
                {locInfo.quants.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">Local vazio</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* Product info */}
        {prodInfo && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
              <Package className="h-5 w-5 text-emerald-400" />
              <span className="font-bold">{prodInfo.product.name}</span>
              <span className="ml-auto text-sm text-emerald-300 font-bold">Stock: {prodTotal}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-800/50 text-xs uppercase tracking-wider text-slate-400">
                <tr><th className="text-left px-3 py-2">Localização</th><th className="text-left px-3 py-2 w-24">Qtd</th><th className="text-left px-3 py-2 w-24">Reserv.</th></tr>
              </thead>
              <tbody>
                {prodInfo.quants.map((q, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="px-3 py-2">{q.stock_locations?.full_path ?? q.stock_locations?.name}</td>
                    <td className="px-3 py-2 font-bold">{q.quantity}</td>
                    <td className="px-3 py-2 text-amber-300">{q.reserved_quantity}</td>
                  </tr>
                ))}
                {prodInfo.quants.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-500">Sem stock</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-xs text-slate-500 leading-relaxed">
          <strong className="text-slate-400">Como usar:</strong> Bipe um <strong>local</strong> para o consultar · um <strong>produto</strong> para ver o seu stock · uma <strong>transferência</strong> (ex.: <code>WH/OUT/00001</code>) para a abrir.
          Para mover stock: bipe <strong>local origem</strong> → <strong>produto(s)</strong> → <strong>local destino</strong>.
          Comandos: <code>ESC</code> cancela, <code>OK</code> valida.
        </div>
      </div>

      <HistoryPanel history={history} />
    </div>
  );
}
