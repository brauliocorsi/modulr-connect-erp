import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScanLine, CheckCircle2, X, Package, MapPin, Truck, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { stateLabel, kindLabel } from "@/lib/picking";

type Move = {
  id: string;
  product_id: string;
  quantity: number;
  quantity_done: number | null;
  state: string;
  products?: { name: string; barcode: string | null; internal_ref: string | null };
};

export default function BarcodeScanPage() {
  const nav = useNavigate();
  const [picking, setPicking] = useState<any>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [code, setCode] = useState("");
  const [history, setHistory] = useState<{ ts: number; text: string; ok: boolean }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<any[]>([]);

  useEffect(() => {
    inputRef.current?.focus();
    loadPending();
  }, []);

  const loadPending = async () => {
    const { data } = await supabase
      .from("stock_pickings")
      .select("id,name,kind,state,partners(name)")
      .in("state", ["waiting", "ready"])
      .order("created_at", { ascending: false })
      .limit(20);
    setPending(data ?? []);
  };

  const log = (text: string, ok: boolean) => {
    setHistory((h) => [{ ts: Date.now(), text, ok }, ...h].slice(0, 30));
    if (ok) {
      try {
        new Audio("data:audio/wav;base64,UklGRigBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQBAAB/").play().catch(() => {});
      } catch {}
    }
  };

  const loadPicking = async (pickingId: string) => {
    const { data: p } = await supabase
      .from("stock_pickings")
      .select("*, partners(name), source:source_location_id(name,full_path), dest:destination_location_id(name,full_path)")
      .eq("id", pickingId)
      .maybeSingle();
    if (!p) return;
    setPicking(p);
    const { data: m } = await supabase
      .from("stock_moves")
      .select("id,product_id,quantity,quantity_done,state,products(name,barcode,internal_ref)")
      .eq("picking_id", pickingId);
    setMoves((m as any) ?? []);
  };

  const handleScan = async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setCode("");
    // 1. If we don't have an active picking yet, treat as picking name
    if (!picking) {
      const { data: p } = await supabase.from("stock_pickings").select("id,name,state").ilike("name", value).maybeSingle();
      if (p) {
        await loadPicking(p.id);
        log(`Transferência ${p.name} aberta`, true);
        return;
      }
      log(`Transferência "${value}" não encontrada`, false);
      toast.error("Nenhuma transferência com esse código");
      return;
    }
    // 2. Special commands
    const v = value.toUpperCase();
    if (v === "VALIDATE" || v === "OK" || v === "DONE") {
      await validate();
      return;
    }
    if (v === "CANCEL" || v === "ESC") {
      setPicking(null);
      setMoves([]);
      log("Sessão fechada", true);
      return;
    }
    // 3. Try product barcode first
    let target = moves.find((m) => m.products?.barcode === value);
    if (!target) {
      // Or by internal_ref
      target = moves.find((m) => m.products?.internal_ref === value);
    }
    if (!target) {
      // Or by product name partial
      target = moves.find((m) => m.products?.name?.toLowerCase().includes(value.toLowerCase()));
    }
    if (!target) {
      log(`Produto "${value}" não está nesta transferência`, false);
      toast.error("Produto não encontrado na transferência");
      return;
    }
    if (target.state === "done" || target.state === "cancelled") {
      log(`${target.products?.name} já concluído`, false);
      return;
    }
    const cur = Number(target.quantity_done ?? 0);
    const max = Number(target.quantity);
    if (cur >= max) {
      log(`${target.products?.name}: já atingiu o pedido (${max})`, false);
      toast.warning("Quantidade máxima atingida");
      return;
    }
    const next = cur + 1;
    const { error } = await supabase.from("stock_moves").update({ quantity_done: next }).eq("id", target.id);
    if (error) {
      log(`Erro: ${error.message}`, false);
      return;
    }
    setMoves((ms) => ms.map((m) => (m.id === target!.id ? { ...m, quantity_done: next } : m)));
    log(`+1 ${target.products?.name} (${next}/${max})`, true);
  };

  const validate = async () => {
    if (!picking) return;
    for (const m of moves) {
      if (m.quantity_done == null) {
        await supabase.from("stock_moves").update({ quantity_done: m.quantity }).eq("id", m.id);
      }
    }
    const { error } = await supabase.rpc("validate_picking", { _picking: picking.id });
    if (error) {
      toast.error(error.message);
      log(`Validação falhou: ${error.message}`, false);
      return;
    }
    toast.success(`${picking.name} validada`);
    log(`Transferência ${picking.name} validada`, true);
    setPicking(null);
    setMoves([]);
    loadPending();
  };

  const totalDone = moves.reduce((s, m) => s + Number(m.quantity_done ?? 0), 0);
  const totalDemand = moves.reduce((s, m) => s + Number(m.quantity), 0);

  return (
    <>
      <PageHeader
        title="Leitor de códigos"
        breadcrumb={[{ label: "Inventário", to: "/inventory" }, { label: "Códigos" }]}
      />
      <PageBody>
        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
            <Card className="p-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleScan(code);
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <ScanLine className="h-5 w-5 text-primary" />
                  <span className="font-medium">
                    {picking ? `A processar: ${picking.name}` : "Aguardando código de transferência…"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={picking ? "Bipe um produto, ou OK para validar, ESC para sair" : "Bipe o código da transferência (ex.: WH/OUT/00012)"}
                    autoFocus
                    className="font-mono text-base"
                  />
                  <Button type="submit">Bipar</Button>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Comandos: <code>OK</code>/<code>VALIDATE</code> conclui · <code>ESC</code>/<code>CANCEL</code> fecha sessão
                </div>
              </form>
            </Card>

            {picking && (
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <Badge variant="secondary"><Truck className="h-3 w-3 mr-1" />{kindLabel(picking.kind)}</Badge>
                  <Badge>{stateLabel(picking.state)}</Badge>
                  {picking.partners?.name && <span className="text-sm text-muted-foreground">{picking.partners.name}</span>}
                  <span className="ml-auto text-sm font-medium">
                    {totalDone} / {totalDemand}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {picking.source?.full_path ?? picking.source?.name}
                  <ArrowRight className="h-3 w-3 mx-1" />
                  {picking.dest?.full_path ?? picking.dest?.name}
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-2 py-2">Produto</th>
                      <th className="text-left px-2 py-2 w-32">Código</th>
                      <th className="text-left px-2 py-2 w-28">Feito / Pedido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moves.map((m) => {
                      const cur = Number(m.quantity_done ?? 0);
                      const need = Number(m.quantity);
                      const full = cur >= need;
                      return (
                        <tr key={m.id} className={`border-t ${full ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}`}>
                          <td className="px-2 py-2 flex items-center gap-2">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            {m.products?.name}
                          </td>
                          <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{m.products?.barcode ?? m.products?.internal_ref ?? "—"}</td>
                          <td className="px-2 py-2 font-medium">
                            <span className={full ? "text-emerald-700 dark:text-emerald-300" : ""}>{cur}</span>
                            <span className="text-muted-foreground"> / {need}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex gap-2 mt-3 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => { setPicking(null); setMoves([]); }}>
                    <X className="h-4 w-4 mr-1" /> Fechar
                  </Button>
                  <Button size="sm" onClick={validate}>
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Validar
                  </Button>
                </div>
              </Card>
            )}

            {!picking && (
              <Card>
                <div className="px-4 py-3 border-b font-semibold">Transferências pendentes</div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-2">Referência</th>
                      <th className="text-left px-3 py-2">Tipo</th>
                      <th className="text-left px-3 py-2">Estado</th>
                      <th className="text-left px-3 py-2">Parceiro</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="px-3 py-2 font-mono">{p.name}</td>
                        <td className="px-3 py-2">{kindLabel(p.kind)}</td>
                        <td className="px-3 py-2">{stateLabel(p.state)}</td>
                        <td className="px-3 py-2">{p.partners?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" variant="outline" onClick={() => loadPicking(p.id)}>Abrir</Button>
                        </td>
                      </tr>
                    ))}
                    {pending.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Sem transferências pendentes</td></tr>
                    )}
                  </tbody>
                </table>
              </Card>
            )}
          </div>

          <aside className="space-y-3">
            <Card className="p-4">
              <div className="font-semibold mb-2 text-sm">Histórico</div>
              <ul className="space-y-1 text-xs max-h-[420px] overflow-auto">
                {history.length === 0 && <li className="text-muted-foreground">Sem leituras…</li>}
                {history.map((h) => (
                  <li key={h.ts} className={`flex items-start gap-2 ${h.ok ? "text-foreground" : "text-rose-600 dark:text-rose-400"}`}>
                    <span className="font-mono text-muted-foreground">{new Date(h.ts).toLocaleTimeString()}</span>
                    <span>{h.text}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-4 text-xs text-muted-foreground space-y-2">
              <div className="font-semibold text-foreground text-sm">Como usar</div>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Bipe ou digite o código da transferência (ex.: <code>WH/OUT/00001</code>).</li>
                <li>Bipe os códigos de barras dos produtos para incrementar a quantidade.</li>
                <li>Bipe <code>OK</code> ou clique em Validar para concluir.</li>
              </ol>
            </Card>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
