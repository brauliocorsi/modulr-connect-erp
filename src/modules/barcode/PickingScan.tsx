import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useScanner } from "./useScanner";
import { ScanInput, HistoryPanel, ScanLayout } from "./BarcodeUI";
import { CheckCircle2, X, Package } from "lucide-react";

const KIND_LABEL: Record<string, string> = {
  incoming: "Receção",
  outgoing: "Expedição",
  internal: "Transferência interna",
  all: "Picking",
};

type Move = {
  id: string;
  product_id: string;
  quantity: number;
  quantity_done: number | null;
  state: string;
  source_location_id: string;
  destination_location_id: string;
  products?: { name: string; barcode: string | null; internal_ref: string | null };
};

export default function PickingScan() {
  const { kind = "all" } = useParams();
  const nav = useNavigate();
  const [picking, setPicking] = useState<any>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [activeLocation, setActiveLocation] = useState<{ id: string; name: string } | null>(null);
  const [packagesByProduct, setPackagesByProduct] = useState<Record<string, { id: string; sequence: number; label: string; barcode: string | null }[]>>({});
  const [scannedColis, setScannedColis] = useState<Record<string, Set<number>>>({});

  const loadPending = async () => {
    let q = supabase
      .from("stock_pickings")
      .select("id,name,kind,state,partners(name)")
      .in("state", ["waiting", "ready"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (kind !== "all") q = q.eq("kind", kind as any);
    const { data } = await q;
    setPending(data ?? []);
  };

  useEffect(() => { loadPending(); /* eslint-disable-next-line */ }, [kind]);

  const openPicking = async (id: string) => {
    const { data: p } = await supabase
      .from("stock_pickings")
      .select("*, partners(name), source:source_location_id(name,full_path), dest:destination_location_id(name,full_path)")
      .eq("id", id)
      .maybeSingle();
    if (!p) return;
    setPicking(p);
    setActiveLocation(null);
    setScannedColis({});
    // Reset quantity_done to 0 in DB so the operator must re-confirm every unit by scanning
    await supabase
      .from("stock_moves")
      .update({ quantity_done: 0 })
      .eq("picking_id", id)
      .not("state", "in", "(done,cancelled)");
    const { data: m } = await supabase
      .from("stock_moves")
      .select("id,product_id,quantity,quantity_done,state,source_location_id,destination_location_id,products(name,barcode,internal_ref)")
      .eq("picking_id", id);
    const movesData = ((m as any[]) ?? []).map((mv) => ({
      ...mv,
      quantity_done: mv.state === "done" || mv.state === "cancelled" ? mv.quantity_done : 0,
    }));
    setMoves(movesData);
    const pids = Array.from(new Set(movesData.map((mv) => mv.product_id).filter(Boolean)));
    if (pids.length) {
      const { data: pkgs } = await supabase
        .from("product_packages")
        .select("id,product_id,sequence,label,barcode")
        .in("product_id", pids)
        .order("sequence", { ascending: true });
      const map: Record<string, any[]> = {};
      (pkgs ?? []).forEach((pk: any) => { (map[pk.product_id] ||= []).push(pk); });
      setPackagesByProduct(map);
    } else {
      setPackagesByProduct({});
    }
  };

  const handleScan = async (raw: string) => {
    const v = raw.trim();
    const upper = v.toUpperCase();

    if (upper === "ESC" || upper === "CANCEL" || upper === "VOLTAR") {
      if (picking) { setPicking(null); setMoves([]); setActiveLocation(null); log("Sessão fechada", "info"); }
      else nav("/barcode");
      return;
    }

    if (!picking) {
      const { data: p } = await supabase
        .from("stock_pickings")
        .select("id,name,kind,state")
        .ilike("name", v)
        .maybeSingle();
      if (!p) return log(`Transferência "${v}" não encontrada`, "error");
      if (kind !== "all" && p.kind !== kind) return log(`Esta transferência é de tipo "${KIND_LABEL[p.kind]}", não "${KIND_LABEL[kind]}"`, "error");
      if (p.state === "done" || p.state === "cancelled") return log(`Transferência ${p.name} já está ${p.state}`, "warn");
      await openPicking(p.id);
      log(`Transferência ${p.name} aberta`, "ok");
      return;
    }

    if (upper === "OK" || upper === "VALIDATE" || upper === "VALIDAR") {
      await validate();
      return;
    }

    // Try location scan
    const { data: loc } = await supabase
      .from("stock_locations")
      .select("id,name,full_path,barcode")
      .or(`barcode.eq.${v},name.eq.${v},full_path.eq.${v}`)
      .maybeSingle();
    if (loc) {
      const validLoc = moves.some((m) => m.source_location_id === loc.id || m.destination_location_id === loc.id);
      if (!validLoc) return log(`Local "${loc.full_path ?? loc.name}" não pertence a esta transferência`, "error");
      setActiveLocation({ id: loc.id, name: loc.full_path ?? loc.name });
      return log(`Local ativo: ${loc.full_path ?? loc.name}`, "info");
    }

    // Colis (product_packages) scan
    const { data: pkg } = await supabase
      .from("product_packages")
      .select("id,product_id,sequence,label,barcode")
      .eq("barcode", v)
      .maybeSingle();
    if (pkg) {
      const move = moves.find((m) => m.product_id === pkg.product_id);
      if (!move) return log(`Colis "${pkg.label}" pertence a produto fora desta transferência`, "error");
      if (activeLocation && move.source_location_id !== activeLocation.id && move.destination_location_id !== activeLocation.id) {
        return log(`${move.products?.name} não pertence ao local ativo`, "error");
      }
      if (move.state === "done" || move.state === "cancelled") return log(`${move.products?.name} já concluído`, "warn");
      const cur = Number(move.quantity_done ?? 0);
      const max = Number(move.quantity);
      if (cur >= max) return log(`${move.products?.name}: já completo ${max}/${max}`, "warn");
      const totalSeq = (packagesByProduct[pkg.product_id] ?? []).length || 1;
      const set = new Set(scannedColis[move.id] ?? []);
      if (set.has(pkg.sequence)) return log(`Colis ${pkg.label} já bipado para esta unidade`, "warn");
      set.add(pkg.sequence);
      if (set.size >= totalSeq) {
        const next = cur + 1;
        const { error } = await supabase.from("stock_moves").update({ quantity_done: next }).eq("id", move.id);
        if (error) return log(error.message, "error");
        setMoves((ms) => ms.map((m) => (m.id === move.id ? { ...m, quantity_done: next } : m)));
        setScannedColis((s) => ({ ...s, [move.id]: new Set() }));
        log(`✓ Unidade completa de ${move.products?.name} (${next}/${max})`, "ok");
      } else {
        setScannedColis((s) => ({ ...s, [move.id]: set }));
        log(`+ Colis ${pkg.label} (${set.size}/${totalSeq}) — ${move.products?.name}`, "info");
      }
      return;
    }

    // Product scan
    const candidate = moves.find((m) => m.products?.barcode === v) ||
                      moves.find((m) => m.products?.internal_ref === v) ||
                      moves.find((m) => m.products?.name?.toLowerCase() === v.toLowerCase());
    if (!candidate) {
      // Maybe product exists but not in picking
      const { data: prod } = await supabase
        .from("products")
        .select("id,name")
        .or(`barcode.eq.${v},internal_ref.eq.${v}`)
        .maybeSingle();
      if (prod) return log(`"${prod.name}" não faz parte desta transferência!`, "error");
      return log(`Código "${v}" não reconhecido`, "error");
    }
    if (activeLocation && candidate.source_location_id !== activeLocation.id && candidate.destination_location_id !== activeLocation.id) {
      return log(`${candidate.products?.name} não pertence ao local ativo`, "error");
    }
    if (candidate.state === "done" || candidate.state === "cancelled") {
      return log(`${candidate.products?.name} já concluído`, "warn");
    }
    const cur = Number(candidate.quantity_done ?? 0);
    const max = Number(candidate.quantity);
    if (cur >= max) return log(`${candidate.products?.name}: já bipou ${max}/${max}`, "warn");
    // If product has colis defined, force colis scanning
    if ((packagesByProduct[candidate.product_id] ?? []).length > 0) {
      return log(`${candidate.products?.name} requer scan dos colis (não use o código do produto)`, "warn");
    }
    const next = cur + 1;
    const { error } = await supabase.from("stock_moves").update({ quantity_done: next }).eq("id", candidate.id);
    if (error) return log(error.message, "error");
    setMoves((ms) => ms.map((m) => (m.id === candidate.id ? { ...m, quantity_done: next } : m)));
    log(`+1 ${candidate.products?.name} (${next}/${max})`, "ok");
  };

  const { code, setCode, inputRef, submit, log, history, flash } = useScanner(handleScan);

  const validate = async () => {
    if (!picking) return;
    const incomplete = moves.filter((m) => m.state !== "done" && m.state !== "cancelled" && Number(m.quantity_done ?? 0) < Number(m.quantity));
    if (incomplete.length > 0) {
      const names = incomplete.map((m) => `${m.products?.name} (${Number(m.quantity_done ?? 0)}/${Number(m.quantity)})`).join(", ");
      return log(`Faltam scans: ${names}`, "error");
    }
    const { error } = await supabase.rpc("validate_picking", { _picking: picking.id });
    if (error) return log(`Falha: ${error.message}`, "error");
    log(`✓ ${picking.name} validada`, "ok");
    setPicking(null); setMoves([]); setActiveLocation(null);
    loadPending();
  };

  const totalDone = moves.reduce((s, m) => s + Number(m.quantity_done ?? 0), 0);
  const totalDemand = moves.reduce((s, m) => s + Number(m.quantity), 0);

  return (
    <ScanLayout
      title={KIND_LABEL[kind] ?? "Picking"}
      subtitle={picking ? `${picking.name} · ${picking.partners?.name ?? ""}` : "Bipe o código de uma transferência para começar"}
      actions={picking ? (
        <>
          <button onClick={() => { setPicking(null); setMoves([]); }} className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-sm">
            <X className="inline h-4 w-4 mr-1" /> Fechar
          </button>
          <button onClick={validate} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold">
            <CheckCircle2 className="inline h-4 w-4 mr-1" /> Validar
          </button>
        </>
      ) : null}
    >
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <ScanInput
            inputRef={inputRef}
            code={code}
            setCode={setCode}
            onSubmit={() => submit()}
            placeholder={picking ? "Bipe produto, local, OK ou ESC" : "Bipe código da transferência (ex.: WH/IN/00001)"}
            flash={flash}
          />

          {picking && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-xs">{KIND_LABEL[picking.kind]}</span>
                  <span className="text-slate-400">{picking.source?.full_path ?? picking.source?.name} → {picking.dest?.full_path ?? picking.dest?.name}</span>
                </div>
                <div className="text-sm font-semibold">{totalDone} / {totalDemand}</div>
              </div>
              {activeLocation && (
                <div className="px-4 py-2 bg-sky-950/40 text-sky-200 text-xs border-b border-sky-900">
                  Local ativo: <strong>{activeLocation.name}</strong> — apenas produtos deste local serão aceites
                </div>
              )}
              <table className="w-full text-sm">
                <thead className="bg-slate-800/50 text-xs uppercase tracking-wider text-slate-400">
                  <tr><th className="text-left px-3 py-2">Produto</th><th className="text-left px-3 py-2 w-32">Código</th><th className="text-left px-3 py-2 w-28">Feito / Pedido</th></tr>
                </thead>
                <tbody>
                  {moves.map((m) => {
                    const cur = Number(m.quantity_done ?? 0);
                    const need = Number(m.quantity);
                    const full = cur >= need;
                    const pkgs = packagesByProduct[m.product_id] ?? [];
                    const scanned = scannedColis[m.id] ?? new Set<number>();
                    return (
                      <tr key={m.id} className={`border-t border-slate-800 ${full ? "bg-emerald-950/40" : ""}`}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2"><Package className="h-4 w-4 text-slate-500" />{m.products?.name}</div>
                          {pkgs.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1 pl-6">
                              {pkgs.map((p) => (
                                <span key={p.id} className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${scanned.has(p.sequence) ? "bg-emerald-700 text-white" : "bg-slate-800 text-slate-400"}`}>
                                  {p.label}{p.barcode ? ` · ${p.barcode}` : ""}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">{m.products?.barcode ?? m.products?.internal_ref ?? "—"}</td>
                        <td className="px-3 py-2 font-bold"><span className={full ? "text-emerald-300" : "text-white"}>{cur}</span><span className="text-slate-500"> / {need}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!picking && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">Pendentes</div>
              <ul>
                {pending.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => openPicking(p.id)} className="w-full text-left px-4 py-3 hover:bg-slate-800 border-b border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="font-mono">{p.name}</div>
                        <div className="text-xs text-slate-400">{KIND_LABEL[p.kind]} · {p.partners?.name ?? "—"}</div>
                      </div>
                      <span className="text-xs px-2 py-1 rounded bg-slate-800">{p.state}</span>
                    </button>
                  </li>
                ))}
                {pending.length === 0 && <li className="px-4 py-6 text-center text-slate-500 text-sm">Sem transferências pendentes</li>}
              </ul>
            </div>
          )}
        </div>
        <HistoryPanel history={history} />
      </div>
    </ScanLayout>
  );
}
