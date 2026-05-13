import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, CheckCircle2, ScanLine, AlertTriangle, Banknote, Plus, Minus, X, Wrench, Package as PackageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useScanner } from "@/modules/barcode/useScanner";
import { ServiceRequestDialog } from "@/modules/delivery/components/ServiceRequestDialog";

type PayLine = { method_id: string; amount: number };

export default function DeliveryPicking() {
  const { id } = useParams();
  const nav = useNavigate();
  const [pk, setPk] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [scanned, setScanned] = useState<Record<string, number>>({});
  const [openPay, setOpenPay] = useState(false);
  const [methods, setMethods] = useState<any[]>([]);
  const [payments, setPayments] = useState<PayLine[]>([]);
  const [openBalance, setOpenBalance] = useState(0);
  const [openSR, setOpenSR] = useState(false);
  const [routeId, setRouteId] = useState<string | null>(null);

  const load = async () => {
    const { data: p } = await supabase
      .from("stock_pickings")
      .select("id, name, state, origin, route_id, partner_id, partners(name, street, city, phone)")
      .eq("id", id!).maybeSingle();
    setPk(p);
    setRouteId(p?.route_id ?? null);
    const { data: ms } = await supabase
      .from("stock_moves")
      .select("id, quantity, quantity_done, package_id, products(id, name, barcode, internal_ref), product_packages(id, label, barcode)")
      .eq("picking_id", id!);
    setMoves(ms ?? []);
    if (p?.origin) {
      const { data: so } = await supabase.from("sale_orders").select("id, amount_total").eq("name", p.origin).maybeSingle();
      const { data: pays } = await supabase.from("customer_payments").select("amount")
        .eq("order_id", so?.id ?? "00000000-0000-0000-0000-000000000000").eq("state", "posted");
      const paid = (pays ?? []).reduce((a: number, x: any) => a + Number(x.amount || 0), 0);
      const bal = Math.max(0, Number(so?.amount_total ?? 0) - paid);
      setOpenBalance(bal);
    }
    const { data: mt } = await supabase.from("payment_methods").select("id, name").eq("active", true).order("name");
    setMethods(mt ?? []);
  };
  useEffect(() => { if (id) load(); }, [id]);

  const handleScan = (code: string) => {
    // 1) match by package barcode → marca todo o move (a "caixa")
    const byPkg = moves.find((m: any) => m.product_packages?.barcode && m.product_packages.barcode === code);
    if (byPkg) {
      const need = Number(byPkg.quantity);
      if ((scanned[byPkg.id] ?? 0) >= need) {
        toast.warning("Caixa já confirmada", { description: byPkg.product_packages?.label });
        return;
      }
      setScanned((s) => ({ ...s, [byPkg.id]: need }));
      toast.success(`Caixa ${byPkg.product_packages?.label} ✓`, { description: byPkg.products?.name });
      return;
    }
    // 2) fallback: produto avulso (sem colis)
    const m = moves.find((x: any) => x.products?.barcode === code || x.products?.internal_ref === code);
    if (!m) {
      toast.error("Código não pertence a esta entrega", { description: code });
      try { navigator.vibrate?.(400); } catch {}
      return;
    }
    const cur = scanned[m.id] ?? 0;
    if (cur >= Number(m.quantity)) {
      toast.warning("Quantidade já atingida", { description: m.products?.name });
      return;
    }
    setScanned({ ...scanned, [m.id]: cur + 1 });
    toast.success(`+1 ${m.products?.name}`);
  };
  const scanner = useScanner(handleScan);

  const allOk = moves.length > 0 && moves.every((m: any) => (scanned[m.id] ?? 0) >= Number(m.quantity));

  const totalPay = useMemo(() => payments.reduce((a, p) => a + (Number(p.amount) || 0), 0), [payments]);
  const remaining = Math.max(0, openBalance - totalPay);
  const canConfirm = Math.abs(totalPay - openBalance) <= 0.01;

  const openPayDialog = () => {
    if (payments.length === 0 && methods[0]) {
      setPayments([{ method_id: methods[0].id, amount: openBalance }]);
    }
    setOpenPay(true);
  };

  const addLine = () => {
    if (!methods[0]) return;
    const used = new Set(payments.map((p) => p.method_id));
    const free = methods.find((m: any) => !used.has(m.id)) ?? methods[0];
    setPayments((s) => [...s, { method_id: free.id, amount: remaining }]);
  };

  const finalize = async () => {
    if (!canConfirm) {
      return toast.error("Soma não bate com saldo em aberto", {
        description: `Total: ${totalPay.toFixed(2)} € · Em aberto: ${openBalance.toFixed(2)} €`,
      });
    }
    setOpenPay(false);
    const { error } = await supabase.rpc("driver_deliver_picking_multi", {
      _picking: id!,
      _payments: payments.filter((p) => p.amount > 0),
    });
    if (error) return toast.error(error.message);
    toast.success("Entrega concluída ✅");
    load(); // refresca para refletir done
  };

  if (!pk) return <div className="p-4 text-slate-500">A carregar…</div>;
  const locked = pk.state === "done" || pk.state === "cancelled";

  const productsForSR = moves
    .map((m: any) => m.products)
    .filter((p: any) => p)
    .filter((p: any, i: number, arr: any[]) => arr.findIndex((x) => x.id === p.id) === i);

  return (
    <div className="p-4 space-y-3">
      <button onClick={() => nav(-1)} className="inline-flex items-center text-sm text-slate-400 hover:text-slate-200">
        <ChevronLeft className="h-4 w-4" /> Voltar
      </button>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="font-semibold">{pk.partners?.name}</div>
        <div className="text-xs text-slate-400">{pk.partners?.street} · {pk.partners?.city}</div>
        {pk.partners?.phone && <div className="text-xs text-slate-400">📞 {pk.partners.phone}</div>}
        <div className="text-xs text-slate-500 mt-1">{pk.name} · {pk.origin}</div>
      </div>

      {locked && (
        <div className="bg-emerald-950/40 border border-emerald-800 rounded-lg p-3 text-emerald-300 text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> Entrega já {pk.state === "done" ? "concluída" : "cancelada"}.
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-lg">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400">
          <ScanLine className="h-3 w-3" /> Scaneia caixa-a-caixa (ou produto avulso)
        </div>
        {!locked && (
          <form className="p-2 border-b border-slate-800" onSubmit={(e) => { e.preventDefault(); scanner.submit(); }}>
            <input ref={scanner.inputRef} value={scanner.code} onChange={(e) => scanner.setCode(e.target.value)}
              autoFocus inputMode="none"
              className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 text-sm outline-none border border-slate-700 focus:border-emerald-500"
              placeholder="Aguarda scan…" />
          </form>
        )}
        <div className="divide-y divide-slate-800">
          {moves.map((m: any) => {
            const done = locked ? Number(m.quantity_done ?? m.quantity) : (scanned[m.id] ?? 0);
            const need = Number(m.quantity);
            const ok = done >= need;
            const isColis = !!m.product_packages?.barcode;
            const dec = () => setScanned((s) => ({ ...s, [m.id]: Math.max(0, (s[m.id] ?? 0) - 1) }));
            const inc = () => {
              const cur = scanned[m.id] ?? 0;
              if (cur >= need) { toast.warning("Quantidade já atingida", { description: m.products?.name }); return; }
              setScanned((s) => ({ ...s, [m.id]: isColis ? need : cur + 1 }));
            };
            return (
              <div key={m.id} className={`p-3 flex items-center justify-between gap-3 ${ok ? "bg-emerald-950/30" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate flex items-center gap-1">
                    {isColis && <PackageIcon className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                    {m.products?.name}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {isColis
                      ? <>Caixa: {m.product_packages.label} · <span className="font-mono">{m.product_packages.barcode}</span></>
                      : (m.products?.barcode ?? m.products?.internal_ref ?? "—")}
                  </div>
                </div>
                <div className={`text-sm font-mono ${ok ? "text-emerald-400" : "text-slate-300"}`}>
                  {done} / {need}
                </div>
                {!locked && (
                  <div className="flex items-center gap-1">
                    <Button type="button" size="icon" variant="outline" className="h-10 w-10" onClick={dec} disabled={done <= 0}>
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="icon" className="h-10 w-10 bg-emerald-500 hover:bg-emerald-600" onClick={inc} disabled={ok}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!locked && (
        <Button className="w-full h-14 text-base bg-emerald-500 hover:bg-emerald-600" disabled={!allOk}
          onClick={openPayDialog}>
          {allOk ? <><CheckCircle2 className="h-5 w-5 mr-2" /> Entregar e Cobrar</> : <><AlertTriangle className="h-5 w-5 mr-2" /> Scaneia tudo primeiro</>}
        </Button>
      )}

      <Button variant="outline" className="w-full" onClick={() => setOpenSR(true)}>
        <Wrench className="h-4 w-4 mr-2" /> Abrir pedido de assistência
      </Button>

      <ServiceRequestDialog
        open={openSR}
        onOpenChange={setOpenSR}
        pickingId={pk.id}
        partnerId={pk.partner_id}
        routeId={routeId}
        products={productsForSR}
      />

      <Dialog open={openPay} onOpenChange={setOpenPay}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Banknote className="h-5 w-5 text-emerald-500" /> Cobrança na entrega</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-xs text-muted-foreground">Em aberto</div>
                <div className="font-semibold tabular-nums">{openBalance.toFixed(2)} €</div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-xs text-muted-foreground">Cobrado</div>
                <div className={`font-semibold tabular-nums ${canConfirm ? "text-emerald-600" : ""}`}>{totalPay.toFixed(2)} €</div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-xs text-muted-foreground">Falta</div>
                <div className={`font-semibold tabular-nums ${remaining > 0.01 ? "text-rose-600" : "text-emerald-600"}`}>
                  {remaining.toFixed(2)} €
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {payments.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    className="h-9 border rounded-md px-2 bg-background flex-1"
                    value={p.method_id}
                    onChange={(e) => setPayments((s) => s.map((x, j) => j === i ? { ...x, method_id: e.target.value } : x))}
                  >
                    {methods.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <Input type="number" step="0.01" className="w-32"
                    value={p.amount}
                    onChange={(e) => setPayments((s) => s.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} />
                  <Button type="button" size="icon" variant="ghost" onClick={() => setPayments((s) => s.filter((_, j) => j !== i))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="h-3 w-3 mr-1" /> Adicionar pagamento
                </Button>
                {remaining > 0.01 && payments.length > 0 && (
                  <Button type="button" variant="ghost" size="sm"
                    onClick={() => setPayments((s) => s.map((x, i) => i === s.length - 1 ? { ...x, amount: x.amount + remaining } : x))}>
                    Atribuir falta à última linha
                  </Button>
                )}
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Podes dividir em vários métodos (ex.: 70 € em dinheiro + 30 € em multibanco). A soma tem de ser igual ao valor em aberto.
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenPay(false)}>Cancelar</Button>
            <Button onClick={finalize} disabled={!canConfirm}>Confirmar entrega</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
