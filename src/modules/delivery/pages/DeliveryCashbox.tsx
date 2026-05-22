import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Wallet, LockOpen, Banknote, CreditCard, ShieldCheck, Clock, Map as MapIcon, ChevronRight } from "lucide-react";
import { toast } from "sonner";

type Sess = any;

export default function DeliveryCashbox() {
  const { user, loading: authLoading } = useAuth();
  const [register, setRegister] = useState<any>(null);
  const [session, setSession] = useState<Sess | null>(null);
  const [pendingList, setPendingList] = useState<Sess[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [route, setRoute] = useState<any>(null);
  const [opening, setOpening] = useState(0);
  const [counted, setCounted] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"current" | "pending">("current");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingMovs, setPendingMovs] = useState<Record<string, any[]>>({});
  const [reopening, setReopening] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    const { data: reg, error: regErr } = await supabase.from("cash_registers").select("*")
      .eq("driver_id", user.id).eq("active", true).maybeSingle();
    if (regErr) {
      setLoadError(regErr.message);
      setRegister(null); setSession(null); setMovements([]); setPendingList([]);
      setLoading(false);
      return;
    }
    setRegister(reg);
    if (!reg) { setSession(null); setMovements([]); setPendingList([]); setLoading(false); return; }

    const { data: pend } = await supabase.from("cash_sessions")
      .select("*, delivery_routes(id, route_date, delivery_zones(name))")
      .eq("register_id", reg.id)
      .eq("handover_state", "pending_handover")
      .order("handover_at", { ascending: false });
    setPendingList(pend ?? []);

    const { data: s } = await supabase.from("cash_sessions").select("*")
      .eq("register_id", reg.id).eq("state", "open").maybeSingle();
    setSession(s);

    if (s) {
      const { data: ms } = await supabase
        .from("cash_movements")
        .select("*, customer_payments(method_id, payment_methods(name)), stock_pickings(name, partner_id, partners(name))")
        .eq("session_id", s.id)
        .order("created_at", { ascending: false });
      setMovements(ms ?? []);
      if (s.route_id) {
        const { data: r } = await supabase.from("delivery_routes")
          .select("id, route_date, state, delivery_zones(name), vehicles(license_plate)")
          .eq("id", s.route_id).maybeSingle();
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

  const togglePending = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!pendingMovs[id]) {
      const { data } = await supabase
        .from("cash_movements")
        .select("*, customer_payments(payment_methods(name)), stock_pickings(name, partners(name))")
        .eq("session_id", id)
        .order("created_at", { ascending: false });
      setPendingMovs((prev) => ({ ...prev, [id]: data ?? [] }));
    }
  };

  const reopen = async (id: string) => {
    setReopening(id);
    const { error } = await supabase.rpc("driver_reopen_session" as any, { _session: id });
    setReopening(null);
    if (error) return toast.error("Não foi possível reabrir", { description: error.message });
    toast.success("Sessão reaberta"); load();
  };

  // ---- current-session derivations ----
  const isCash = (m: any) => {
    const name = m.customer_payments?.payment_methods?.name?.toLowerCase() ?? "";
    if (!m.payment_id) return true;
    return ["dinheiro", "cash", "numerário", "numerario"].some((c) => name.includes(c));
  };
  const totalsByMethod = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of movements) {
      if (m.kind === "opening") continue;
      const name = m.customer_payments?.payment_methods?.name ?? (isCash(m) ? "Dinheiro" : m.kind);
      map.set(name, (map.get(name) ?? 0) + Number(m.amount || 0));
    }
    return Array.from(map.entries()).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  }, [movements]);
  const cashTotal = movements.filter(isCash).filter((m) => m.kind !== "opening").reduce((a, m) => a + Number(m.amount || 0), 0);
  const cashOpening = movements.filter((m) => m.kind === "opening").reduce((a, m) => a + Number(m.amount || 0), 0);
  const cashExpected = cashOpening + cashTotal;

  const byPicking = useMemo(() => {
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
  }, [movements]);

  if (loading || authLoading) return <div className="p-6 text-center text-slate-500">A carregar caixa…</div>;
  if (loadError) return (
    <div className="p-6 text-center text-rose-400">
      <Wallet className="h-10 w-10 mx-auto mb-2 opacity-40" /> Erro ao ler o caixa: {loadError}
    </div>
  );
  if (!register) return (
    <div className="p-6 text-center text-slate-500">
      <Wallet className="h-10 w-10 mx-auto mb-2 opacity-40" /> Não tens caixa associado. Pede ao gestor para configurar.
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

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
        <TabsList className="bg-slate-900 border border-slate-800 w-full grid grid-cols-2">
          <TabsTrigger value="current">Sessão atual</TabsTrigger>
          <TabsTrigger value="pending" className="relative">
            Pendentes de conferência
            {pendingList.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500 text-amber-950 font-semibold">
                {pendingList.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="space-y-3 mt-3">
          {!session && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
              <div className="text-sm text-slate-400">
                {pendingList.length > 0 ? "Sem sessão aberta. Podes abrir nova sessão para a próxima rota." : "Sem sessão aberta."}
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

          {session && (
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
            </>
          )}
        </TabsContent>

        <TabsContent value="pending" className="space-y-3 mt-3">
          {pendingList.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 text-center text-slate-500 text-sm">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Sem sessões pendentes de conferência.
            </div>
          ) : (
            pendingList.map((p) => {
              const isOpen = expanded === p.id;
              const movs = pendingMovs[p.id] ?? [];
              const isReturned = p.reconciliation_notes?.toLowerCase().includes("devolvid");
              return (
                <div key={p.id} className="bg-amber-950/30 border border-amber-900/60 rounded-lg overflow-hidden">
                  <button onClick={() => togglePending(p.id)} className="w-full p-4 text-left flex items-start gap-3 hover:bg-amber-950/50">
                    <Clock className="h-5 w-5 text-amber-400 mt-0.5" />
                    <div className="flex-1">
                      <div className="font-semibold text-amber-100">
                        {p.name} {isReturned && <span className="ml-2 text-xs bg-rose-500/30 text-rose-200 px-2 py-0.5 rounded">Devolvida</span>}
                      </div>
                      <div className="text-xs text-amber-200/70 mt-0.5">
                        {p.delivery_routes?.delivery_zones?.name ?? "—"} · {p.delivery_routes?.route_date ?? ""}
                      </div>
                      <div className="text-xs text-amber-200/70">
                        Entregue em {p.handover_at ? new Date(p.handover_at).toLocaleString("pt-PT") : "—"} · contado {Number(p.handover_cash_amount ?? 0).toFixed(2)} €
                      </div>
                      {p.reconciliation_notes && (
                        <div className="text-xs text-amber-200 mt-1 italic">"{p.reconciliation_notes}"</div>
                      )}
                    </div>
                    <ChevronRight className={`h-4 w-4 text-amber-300 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="border-t border-amber-900/60 p-3 space-y-2">
                      <div className="text-xs uppercase tracking-wider text-amber-300/80">Movimentos</div>
                      {movs.length === 0 ? (
                        <div className="text-xs text-amber-200/60">A carregar…</div>
                      ) : (
                        <div className="space-y-1">
                          {movs.map((m: any) => (
                            <div key={m.id} className="flex justify-between text-xs border-b border-amber-900/30 py-1">
                              <span>
                                {m.kind === "opening" ? "Abertura" : (m.customer_payments?.payment_methods?.name ?? m.kind)}
                                {m.stock_pickings?.partners?.name && ` · ${m.stock_pickings.partners.name}`}
                              </span>
                              <span className="font-mono">{Number(m.amount).toFixed(2)} €</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {isReturned && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full mt-2 border-amber-500 text-amber-200 hover:bg-amber-900/40"
                          disabled={reopening === p.id}
                          onClick={() => reopen(p.id)}
                        >
                          <LockOpen className="h-3 w-3 mr-1" />
                          {reopening === p.id ? "A reabrir…" : "Reabrir para ajustes"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
