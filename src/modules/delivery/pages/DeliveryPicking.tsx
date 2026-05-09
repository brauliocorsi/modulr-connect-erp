import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, CheckCircle2, ScanLine, AlertTriangle, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useScanner } from "@/modules/barcode/useScanner";

export default function DeliveryPicking() {
  const { id } = useParams();
  const nav = useNavigate();
  const [pk, setPk] = useState<any>(null);
  const [moves, setMoves] = useState<any[]>([]);
  const [scanned, setScanned] = useState<Record<string, number>>({});
  const [openPay, setOpenPay] = useState(false);
  const [methods, setMethods] = useState<any[]>([]);
  const [methodId, setMethodId] = useState("");
  const [amount, setAmount] = useState(0);
  const [openBalance, setOpenBalance] = useState(0);

  const load = async () => {
    const { data: p } = await supabase
      .from("stock_pickings")
      .select("id, name, state, origin, partners(name, address, city, phone)")
      .eq("id", id!).maybeSingle();
    setPk(p);
    const { data: ms } = await supabase
      .from("stock_moves")
      .select("id, quantity, quantity_done, products(id, name, barcode, default_code)")
      .eq("picking_id", id!);
    setMoves(ms ?? []);
    if (p?.origin) {
      const { data: so } = await supabase.from("sale_orders").select("amount_total").eq("name", p.origin).maybeSingle();
      const { data: pays } = await supabase.from("customer_payments").select("amount").eq("order_id", (await supabase.from("sale_orders").select("id").eq("name", p.origin).maybeSingle()).data?.id ?? "00000000-0000-0000-0000-000000000000").eq("state", "posted");
      const paid = (pays ?? []).reduce((a: number, x: any) => a + Number(x.amount || 0), 0);
      const bal = Math.max(0, Number(so?.amount_total ?? 0) - paid);
      setOpenBalance(bal);
      setAmount(bal);
    }
    const { data: mt } = await supabase.from("payment_methods").select("id, name").eq("active", true).order("name");
    setMethods(mt ?? []);
    if (mt?.[0]) setMethodId(mt[0].id);
  };
  useEffect(() => { if (id) load(); }, [id]);

  const handleScan = (code: string) => {
    const m = moves.find((x: any) => x.products?.barcode === code || x.products?.default_code === code);
    if (!m) {
      toast.error("Produto não pertence a esta entrega", { description: code });
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

  const finalize = async () => {
    setOpenPay(false);
    const { error } = await supabase.rpc("driver_deliver_picking", {
      _picking: id!,
      _payment_amount: amount > 0 ? amount : 0,
      _method_id: amount > 0 ? methodId : null,
    });
    if (error) return toast.error(error.message);
    toast.success("Entrega concluída ✅");
    nav(-1);
  };

  if (!pk) return <div className="p-4 text-slate-500">A carregar…</div>;
  const locked = pk.state === "done" || pk.state === "cancelled";

  return (
    <div className="p-4 space-y-3">
      <Link to={-1 as any} className="inline-flex items-center text-sm text-slate-400 hover:text-slate-200">
        <ChevronLeft className="h-4 w-4" /> Voltar
      </Link>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="font-semibold">{pk.partners?.name}</div>
        <div className="text-xs text-slate-400">{pk.partners?.address} · {pk.partners?.city}</div>
        {pk.partners?.phone && <div className="text-xs text-slate-400">📞 {pk.partners.phone}</div>}
        <div className="text-xs text-slate-500 mt-1">{pk.name} · {pk.origin}</div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400">
          <ScanLine className="h-3 w-3" /> Scaneia cada produto entregue
        </div>
        <form className="p-2 border-b border-slate-800" onSubmit={(e) => { e.preventDefault(); scanner.submit(); }}>
          <input ref={scanner.inputRef} value={scanner.code} onChange={(e) => scanner.setCode(e.target.value)}
            autoFocus inputMode="none"
            className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 text-sm outline-none border border-slate-700 focus:border-emerald-500"
            placeholder="Aguarda scan…" />
        </form>
        <div className="divide-y divide-slate-800">
          {moves.map((m: any) => {
            const done = scanned[m.id] ?? 0;
            const ok = done >= Number(m.quantity);
            return (
              <div key={m.id} className={`p-3 flex items-center justify-between ${ok ? "bg-emerald-950/30" : ""}`}>
                <div className="min-w-0">
                  <div className="font-medium truncate">{m.products?.name}</div>
                  <div className="text-xs text-slate-500">{m.products?.barcode ?? m.products?.default_code ?? "—"}</div>
                </div>
                <div className={`text-sm font-mono ${ok ? "text-emerald-400" : "text-slate-300"}`}>
                  {done} / {Number(m.quantity)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!locked && (
        <Button className="w-full h-14 text-base bg-emerald-500 hover:bg-emerald-600" disabled={!allOk}
          onClick={() => setOpenPay(true)}>
          {allOk ? <><CheckCircle2 className="h-5 w-5 mr-2" /> Entregar e Cobrar</> : <><AlertTriangle className="h-5 w-5 mr-2" /> Scaneia tudo primeiro</>}
        </Button>
      )}

      <Dialog open={openPay} onOpenChange={setOpenPay}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Banknote className="h-5 w-5 text-emerald-500" /> Cobrança na entrega</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Saldo em aberto da venda: <span className="font-semibold text-foreground">{openBalance.toFixed(2)} €</span>
            </div>
            <div>
              <Label>Valor a cobrar</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
            <div>
              <Label>Método</Label>
              <select className="w-full h-9 border rounded-md px-2 bg-background" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {methods.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="text-xs text-muted-foreground">
              Sem cobrança? Pões o valor a 0 e segues — a entrega regista-se na mesma.
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenPay(false)}>Cancelar</Button>
            <Button onClick={finalize}>Confirmar entrega</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
