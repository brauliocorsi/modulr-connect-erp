import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet, LockOpen, Lock, Banknote, CreditCard, ShieldCheck, Clock, Map as MapIcon } from "lucide-react";
import { toast } from "sonner";

export default function DeliveryCashbox() {
  const { user, loading: authLoading } = useAuth();
  const [register, setRegister] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [pendingHandover, setPendingHandover] = useState<any>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [route, setRoute] = useState<any>(null);
  const [opening, setOpening] = useState(0);
  const [counted, setCounted] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    const { data: reg, error: regErr } = await supabase.from("cash_registers").select("*")
      .eq("driver_id", user.id).eq("active", true).maybeSingle();
    if (regErr) {
      setLoadError(regErr.message);
      setRegister(null); setSession(null); setMovements([]); setPendingHandover(null);
      setLoading(false);
      return;
    }
    setRegister(reg);
    if (!reg) { setSession(null); setMovements([]); setPendingHandover(null); setLoading(false); return; }

    // Pendente de conferência?
    const { data: ph } = await supabase.from("cash_sessions").select("*")
      .eq("register_id", reg.id).eq("handover_state", "pending_handover")
      .order("handover_at", { ascending: false }).limit(1).maybeSingle();
    setPendingHandover(ph);

    const { data: s } = await supabase.from("cash_sessions").select("*")
      .eq("register_id", reg.id).eq("state", "open").maybeSingle();
    setSession(s);

    const target = s ?? ph;
    if (target) {
      const { data: ms } = await supabase
        .from("cash_movements")
        .select("*, customer_payments(method_id, payment_methods(name)), stock_pickings(name, partner_id, partners(name))")
        .eq("session_id", target.id)
        .order("created_at", { ascending: false });
      setMovements(ms ?? []);
      if (target.route_id) {
        const { data: r } = await supabase.from("delivery_routes")
          .select("id, route_date, state, delivery_zones(name), vehicles(license_plate)")
          .eq("id", target.route_id).maybeSingle();
        setRoute(r);
      } else setRoute(null);
    } else {
      setMovements([]); setRoute(null);
    }
    setLoading(false);
  };
  useEffect(() => { if (!authLoading) load(); }, [user, authLoading]);

  const open = async () => {
    const { error } = await supabase.rpc("open_cash_session", { _register: register.id, _opening: opening || null });
    if (error) return toast.error(error.message);
    toast.success("Sessão aberta"); load();
  };

  const handover = async () => {
    if (!session) return;
    const { error } = await supabase.rpc("driver_handover_session", {
      _session: session.id, _counted_cash: counted,
    });
    if (error) return toast.error(error.message);
    toast.success("Caixa entregue para conferência"); load();
  };

  // Totais por método (só do alvo carregado)
  const isCash = (m: any) => {
    const name = m.customer_payments?.payment_methods?.name?.toLowerCase() ?? "";
    if (!m.payment_id) return true;
    return ["dinheiro", "cash", "numerário", "numerario"].some((c) => name.includes(c));
  };
  const totalsByMethod = (() => {
    const map = new Map<string, number>();
    for (const m of movements) {
      if (m.kind === "opening") continue;
      const name = m.customer_payments?.payment_methods?.name ?? (isCash(m) ? "Dinheiro" : m.kind);
      map.set(name, (map.get(name) ?? 0) + Number(m.amount || 0));
    }
    return Array.from(map.entries()).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  })();
  const cashTotal = movements.filter(isCash).filter((m) => m.kind !== "opening").reduce((a, m) => a + Number(m.amount || 0), 0);
  const cashOpening = movements.filter((m) => m.kind === "opening").reduce((a, m) => a + Number(m.amount || 0), 0);
  const cashExpected = cashOpening + cashTotal;

  // Agrupar por entrega
  const byPicking = (() => {
    const groups = new Map<string, { name: string; partner: string; total: number; methods: Map<string, number> }>();
    for (const m of movements) {
      if (!m.picking_id || m.kind === "opening") continue;
      const key = m.picking_id;
      if (!groups.has(key)) {
        groups.set(key, {
          name: m.stock_pickings?.name ?? key.slice(0, 8),
          partner: m.stock_pickings?.partners?.name ?? "—",
          total: 0,
          methods: new Map(),
        });
      }
      const g = groups.get(key)!;
      g.total += Number(m.amount || 0);
      const mn = m.customer_payments?.payment_methods?.name ?? (isCash(m) ? "Dinheiro" : m.kind);
      g.methods.set(mn, (g.methods.get(mn) ?? 0) + Number(m.amount || 0));
    }
    return Array.from(groups.values());
  })();

  if (loading || authLoading) return (
    <div className="p-6 text-center text-slate-500">A carregar caixa…</div>
  );

  if (loadError) return (
    <div className="p-6 text-center text-rose-400">
      <Wallet className="h-10 w-10 mx-auto mb-2 opacity-40" />
      Erro ao ler o caixa: {loadError}
    </div>
  );

  if (!register) return (
    <div className="p-6 text-center text-slate-500">
      <Wallet className="h-10 w-10 mx-auto mb-2 opacity-40" />
      Não tens caixa associado. Pede ao gestor para configurar.
    </div>
  );

  return (
    <div className="p-4 space-y-3">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Caixa</div>
        <div className="font-semibold text-lg flex items-center gap-2">
          <Wallet className="h-5 w-5 text-emerald-400" /> {register.name}
        </div>
      </div>

      {pendingHandover && (
        <div className="bg-amber-950/40 border border-amber-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-amber-300 font-semibold">
            <Clock className="h-5 w-5" /> Caixa pendente de conferência financeira
          </div>
          <div className="text-xs text-amber-200/80 mt-1">
            Sessão {pendingHandover.name} entregue em {new Date(pendingHandover.handover_at).toLocaleString("pt-PT")}.
            Não podes abrir nova sessão até o financeiro conciliar.
          </div>
        </div>
      )}

      {!session && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
          <div className="text-sm text-slate-400">
            {pendingHandover ? "Podes abrir nova sessão para a próxima rota." : "Sem sessão aberta."}
          </div>
          <div>
            <Label className="text-xs">Saldo de abertura (deixa 0 para usar saldo anterior)</Label>
            <Input type="number" step="0.01" value={opening} onChange={(e) => setOpening(Number(e.target.value))} />
          </div>
          <Button className="w-full bg-emerald-500 hover:bg-emerald-600" onClick={open}>
            <LockOpen className="h-4 w-4 mr-1" /> Abrir sessão
          </Button>
        </div>
      )}

      {(session || pendingHandover) && (
        <>
          {route && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-sm flex items-center gap-3">
              <MapIcon className="h-5 w-5 text-sky-400" />
              <div className="flex-1">
                <div className="font-medium">Rota: {route.delivery_zones?.name ?? "—"}</div>
                <div className="text-xs text-slate-500">
                  {route.route_date} {route.vehicles?.license_plate && `· 🚐 ${route.vehicles.license_plate}`}
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">{route.state}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-500 flex items-center gap-1"><Banknote className="h-3 w-3" /> Dinheiro esperado</div>
              <div className="font-mono text-lg text-emerald-400">{cashExpected.toFixed(2)} €</div>
              <div className="text-xs text-slate-500">Abertura {cashOpening.toFixed(2)} + recebido {cashTotal.toFixed(2)}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-500 flex items-center gap-1"><CreditCard className="h-3 w-3" /> Outros métodos</div>
              <div className="font-mono text-lg text-sky-300">
                {totalsByMethod.filter(([n]) => !["Dinheiro","cash","sale"].includes(n.toLowerCase())).reduce((a,[,v])=>a+v,0).toFixed(2)} €
              </div>
              <div className="text-xs text-slate-500">MB / cartão / transferência</div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg">
            <div className="px-3 py-2 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">Por método</div>
            <div className="p-3 flex flex-wrap gap-2">
              {totalsByMethod.length === 0 && <div className="text-xs text-slate-500">Sem recebimentos.</div>}
              {totalsByMethod.map(([n, v]) => (
                <div key={n} className="rounded border border-slate-800 bg-slate-800/40 px-3 py-2 min-w-[120px]">
                  <div className="text-xs text-slate-400">{n}</div>
                  <div className={`font-mono ${v < 0 ? "text-rose-400" : "text-emerald-300"}`}>{v.toFixed(2)} €</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg">
            <div className="px-3 py-2 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">Entregas da rota</div>
            <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
              {byPicking.length === 0 && <div className="p-4 text-slate-500 text-sm text-center">Sem entregas com pagamento.</div>}
              {byPicking.map((g, i) => (
                <div key={i} className="p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{g.partner}</div>
                      <div className="text-xs text-slate-500">{g.name}</div>
                    </div>
                    <div className="font-mono text-emerald-400">{g.total.toFixed(2)} €</div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Array.from(g.methods.entries()).map(([n, v]) => (
                      <span key={n} className="text-xs bg-slate-800 px-2 py-0.5 rounded">
                        {n}: <span className="font-mono">{v.toFixed(2)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {session && !pendingHandover && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
              <div className="text-sm text-slate-400">Fim do dia — conta o dinheiro físico e entrega o caixa:</div>
              <div>
                <Label className="text-xs">Dinheiro contado</Label>
                <Input type="number" step="0.01" value={counted} onChange={(e) => setCounted(Number(e.target.value))} />
              </div>
              <Button variant="destructive" className="w-full" onClick={handover}>
                <ShieldCheck className="h-4 w-4 mr-1" /> Encerrar e entregar caixa para conferência
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
