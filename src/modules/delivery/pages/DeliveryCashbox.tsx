import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet, LockOpen, Lock } from "lucide-react";
import { toast } from "sonner";

export default function DeliveryCashbox() {
  const { user } = useAuth();
  const [register, setRegister] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [opening, setOpening] = useState(0);
  const [counted, setCounted] = useState(0);

  const load = async () => {
    if (!user) return;
    const { data: reg } = await supabase.from("cash_registers").select("*").eq("driver_id", user.id).eq("active", true).maybeSingle();
    setRegister(reg);
    if (!reg) { setSession(null); setMovements([]); return; }
    const { data: s } = await supabase.from("cash_sessions").select("*").eq("register_id", reg.id).eq("state", "open").maybeSingle();
    setSession(s);
    if (s) {
      const { data: ms } = await supabase.from("cash_movements").select("*").eq("session_id", s.id).order("created_at", { ascending: false });
      setMovements(ms ?? []);
    }
  };
  useEffect(() => { load(); }, [user]);

  const open = async () => {
    const { error } = await supabase.rpc("open_cash_session", { _register: register.id, _opening: opening || null });
    if (error) return toast.error(error.message);
    toast.success("Sessão aberta"); load();
  };
  const close = async () => {
    const { error } = await supabase.rpc("close_cash_session", { _session: session.id, _counted: counted });
    if (error) return toast.error(error.message);
    toast.success("Sessão fechada"); load();
  };

  const total = movements.reduce((a, m) => a + Number(m.amount || 0), 0);

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

      {!session && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
          <div className="text-sm text-slate-400">Sem sessão aberta. Abre a sessão para começares o dia.</div>
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
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500">Sessão {session.name}</div>
            <div className="grid grid-cols-2 gap-3 mt-2 text-sm">
              <div>
                <div className="text-slate-500 text-xs">Abertura</div>
                <div className="font-mono">{Number(session.opening_balance).toFixed(2)} €</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs">Total movimentos</div>
                <div className="font-mono text-emerald-400">{total.toFixed(2)} €</div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg">
            <div className="px-3 py-2 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">Movimentos</div>
            <div className="divide-y divide-slate-800 max-h-80 overflow-auto">
              {movements.map((m) => (
                <div key={m.id} className="p-3 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium">{m.reference ?? m.kind}</div>
                    <div className="text-xs text-slate-500">{new Date(m.created_at).toLocaleString("pt-PT")}</div>
                  </div>
                  <div className={`font-mono ${Number(m.amount) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {Number(m.amount).toFixed(2)} €
                  </div>
                </div>
              ))}
              {movements.length === 0 && <div className="p-4 text-slate-500 text-sm text-center">Sem movimentos.</div>}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="text-sm text-slate-400">Fim do dia — conta o dinheiro físico:</div>
            <div>
              <Label className="text-xs">Saldo contado</Label>
              <Input type="number" step="0.01" value={counted} onChange={(e) => setCounted(Number(e.target.value))} />
            </div>
            <Button variant="destructive" className="w-full" onClick={close}>
              <Lock className="h-4 w-4 mr-1" /> Fechar sessão e prestar contas
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
