import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useScanner } from "./useScanner";
import { ScanInput, HistoryPanel, ScanLayout } from "./BarcodeUI";
import { Package, MapPin, X, CheckCircle2, Printer } from "lucide-react";
import { printBinLabel, printColisLabels } from "./printBarcodes";

type Pending = {
  product_id: string;
  product_name: string;
  package_id: string | null;
  package_label: string | null;
  qty: number;
};

export default function PutawayScan() {
  const nav = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);
  const [history, setHistoryDone] = useState<{ name: string; loc: string; ts: number }[]>([]);

  const handleScan = async (raw: string) => {
    const v = raw.trim();
    const upper = v.toUpperCase();
    if (!v) return;

    if (upper === "ESC" || upper === "CANCEL" || upper === "VOLTAR") {
      if (pending) { setPending(null); log("Item descartado", "info"); }
      else nav("/barcode");
      return;
    }
    if (upper === "OK" || upper === "FIM") {
      log(`Sessão terminada — ${history.length} arrumações`, "ok");
      setPending(null);
      return;
    }

    // If we already have a pending item, the next scan must be a destination location
    if (pending) {
      const { data: loc } = await supabase
        .from("stock_locations")
        .select("id, name, full_path, type, is_bin, warehouse_id")
        .or(`barcode.eq.${v},name.eq.${v},full_path.eq.${v}`)
        .maybeSingle();
      if (!loc) {
        // Maybe user wanted to scan another colis/product first — try that
        await tryPickItem(v);
        return;
      }
      if (loc.type !== "internal") return log("Localização não é interna", "error");
      if (!loc.is_bin) return log(`"${loc.full_path ?? loc.name}" não é uma bin (estante/posição)`, "warn");

      const { data, error } = await supabase.rpc("putaway_stock", {
        _product: pending.product_id,
        _package: pending.package_id,
        _qty: pending.qty,
        _location: loc.id,
      });
      if (error) return log(`Falha: ${error.message}`, "error");
      const labelExtra = pending.package_label ? ` · ${pending.package_label}` : "";
      log(`✓ ${pending.qty}× ${pending.product_name}${labelExtra} → ${loc.full_path ?? loc.name}`, "ok");
      setHistoryDone((h) => [{ name: `${pending.product_name}${labelExtra}`, loc: loc.full_path ?? loc.name, ts: Date.now() }, ...h].slice(0, 30));
      setPending(null);
      return;
    }

    await tryPickItem(v);
  };

  const tryPickItem = async (v: string) => {
    // 1) Try colis
    const { data: pkg } = await supabase
      .from("product_packages")
      .select("id, product_id, sequence, label, products(name)")
      .eq("barcode", v)
      .maybeSingle();
    if (pkg) {
      setPending({
        product_id: pkg.product_id,
        product_name: (pkg as any).products?.name ?? "Produto",
        package_id: pkg.id,
        package_label: pkg.label,
        qty: 1,
      });
      return log(`Colis ${pkg.label} de ${(pkg as any).products?.name}. Bipe a localização destino…`, "info");
    }

    // 2) Try product (barcode or internal_ref)
    const { data: prod } = await supabase
      .from("products")
      .select("id, name")
      .or(`barcode.eq.${v},internal_ref.eq.${v}`)
      .maybeSingle();
    if (prod) {
      // Block if product has colis (must scan colis instead)
      const { count } = await supabase
        .from("product_packages")
        .select("id", { count: "exact", head: true })
        .eq("product_id", prod.id);
      if ((count ?? 0) > 0) {
        return log(`${prod.name} tem colis definidos. Bipe um colis específico.`, "warn");
      }
      setPending({
        product_id: prod.id,
        product_name: prod.name,
        package_id: null,
        package_label: null,
        qty: 1,
      });
      return log(`${prod.name}. Bipe a localização destino…`, "info");
    }

    return log(`Código "${v}" não reconhecido`, "error");
  };

  const { code, setCode, inputRef, submit, log, history: scanHistory, flash } = useScanner(handleScan);

  return (
    <ScanLayout
      title="Arrumar"
      subtitle={pending ? `Aguardando localização para ${pending.product_name}${pending.package_label ? " · " + pending.package_label : ""}` : "Bipe um colis ou produto e depois a localização destino"}
      actions={pending ? (
        <button onClick={() => { setPending(null); log("Cancelado", "info"); }} className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-sm">
          <X className="inline h-4 w-4 mr-1" /> Cancelar item
        </button>
      ) : null}
    >
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <ScanInput
            inputRef={inputRef}
            code={code}
            setCode={setCode}
            onSubmit={() => submit()}
            placeholder={pending ? "Bipe a LOCALIZAÇÃO destino" : "Bipe um COLIS ou PRODUTO"}
            flash={flash}
          />

          {pending && (
            <div className="bg-amber-950/40 border border-amber-800 rounded-xl p-4 flex items-center gap-3">
              <Package className="h-8 w-8 text-amber-300" />
              <div className="flex-1">
                <div className="font-semibold text-amber-100">{pending.product_name}</div>
                {pending.package_label && <div className="text-amber-300 text-sm font-mono">Colis {pending.package_label}</div>}
                <div className="text-xs text-amber-400 mt-1">A aguardar bipagem da localização destino…</div>
              </div>
              <MapPin className="h-8 w-8 text-amber-300 animate-pulse" />
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-slate-400">Arrumações nesta sessão</span>
              <span className="text-sm font-semibold">{history.length}</span>
            </div>
            {history.length === 0 ? (
              <div className="px-4 py-6 text-center text-slate-500 text-sm">Nenhuma arrumação ainda</div>
            ) : (
              <ul className="divide-y divide-slate-800">
                {history.map((h) => (
                  <li key={h.ts} className="px-4 py-2 text-sm flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> {h.name}</span>
                    <span className="text-xs text-slate-400 font-mono">{h.loc}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <HistoryPanel history={scanHistory} />
      </div>
    </ScanLayout>
  );
}
