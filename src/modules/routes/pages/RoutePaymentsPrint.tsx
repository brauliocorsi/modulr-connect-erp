import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo } from "react";

// Print-friendly view of all receipts collected on a route.
export default function RoutePaymentsPrint() {
  const { id } = useParams();

  const { data: route } = useQuery({
    queryKey: ["route-pay-print", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("delivery_routes")
        .select("*, delivery_zones(name), vehicles(name,license_plate)")
        .eq("id", id!).maybeSingle()).data,
  });

  const { data: routeOrders = [] } = useQuery<any[]>({
    queryKey: ["route-pay-orders", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("delivery_route_orders")
        .select(`id, sequence,
                 delivery_schedules(sale_order_id,
                   sale_orders(id, name, amount_total, partners(name)))`)
        .eq("route_id", id!).order("sequence")).data ?? [],
  });

  const orderIds = (routeOrders as any[])
    .map((o) => o?.delivery_schedules?.sale_order_id).filter(Boolean);

  const { data: payments = [] } = useQuery<any[]>({
    queryKey: ["route-pay-pays", id, orderIds.join(",")],
    enabled: !!id && orderIds.length > 0,
    queryFn: async () =>
      (await supabase
        .from("customer_payments")
        .select(`id, order_id, amount, state, reference, payment_date, created_at,
                 payment_methods(name, code), sale_orders!customer_payments_order_id_fkey(name, partners(name))`)
        .in("order_id", orderIds)
        .eq("state", "posted")
        .order("payment_date", { ascending: true })).data ?? [],
  });

  const { data: people = [] } = useQuery<any[]>({
    queryKey: ["route-pay-people"],
    queryFn: async () => (await supabase.from("profiles").select("id,full_name")).data ?? [],
  });

  useEffect(() => {
    if (route) {
      const t = setTimeout(() => window.print(), 500);
      return () => clearTimeout(t);
    }
  }, [route, payments.length]);

  const total = useMemo(() => (payments as any[]).reduce((a, p) => a + Number(p.amount ?? 0), 0), [payments]);
  const byMethod = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments as any[]) {
      const k = p.payment_methods?.name ?? p.payment_methods?.code ?? "—";
      m.set(k, (m.get(k) ?? 0) + Number(p.amount ?? 0));
    }
    return Array.from(m.entries());
  }, [payments]);

  if (!route) return <div style={{ padding: 24 }}>A carregar…</div>;
  const r: any = route;
  const driver = (people as any[]).find((p) => p.id === r.driver_id)?.full_name ?? "—";
  const fmtEur = (n: number) => Number(n || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

  return (
    <div className="pay-print">
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print { html, body { background: white !important; } .no-print { display: none !important; } }
        .pay-print { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color: #111; padding: 20px; max-width: 900px; margin: 0 auto; font-size: 12px; }
        .pay-print h1 { font-size: 20px; margin: 0 0 4px; }
        .pay-print h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 1px solid #333; padding-bottom: 2px; }
        .pay-print .row { display:flex; justify-content: space-between; gap: 16px; }
        .pay-print table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .pay-print th, .pay-print td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
        .pay-print th { background: #f0f0f0; }
        .pay-print .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .pay-print .right { text-align: right; }
        .pay-print .muted { color: #555; }
        .pay-print .small { font-size: 10px; }
        .pay-print tfoot td { font-weight: 700; background: #f7f7f7; }
        .pay-print .sig { margin-top: 28px; display: flex; gap: 32px; }
        .pay-print .sig .line { flex: 1; border-top: 1px solid #000; padding-top: 4px; font-size: 11px; text-align: center; }
      `}</style>

      <button className="no-print" onClick={() => window.print()} style={{ marginBottom: 12, padding: "6px 12px" }}>
        Imprimir
      </button>

      <header className="row" style={{ alignItems: "flex-start" }}>
        <div>
          <h1>Recebimentos da Rota</h1>
          <div className="muted">{r.delivery_zones?.name ?? "—"} · {r.route_date}</div>
          <div className="small mono">ID Rota: {r.id}</div>
        </div>
        <div className="right">
          <div><strong>Viatura:</strong> {r.vehicles?.name ?? "—"} {r.vehicles?.license_plate ? `(${r.vehicles.license_plate})` : ""}</div>
          <div><strong>Motorista:</strong> {driver}</div>
          <div><strong>Estado:</strong> {r.state}</div>
          <div className="small muted">Impresso em {new Date().toLocaleString("pt-PT")}</div>
        </div>
      </header>

      <h2>Recebimentos ({(payments as any[]).length})</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Data</th>
            <th>Cliente</th>
            <th>Documento (SO)</th>
            <th>Método</th>
            <th>Referência</th>
            <th className="right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {(payments as any[]).map((p, i) => (
            <tr key={p.id}>
              <td>{i + 1}</td>
              <td>{p.payment_date ?? (p.created_at ? new Date(p.created_at).toLocaleDateString("pt-PT") : "—")}</td>
              <td>{p.sale_orders?.partners?.name ?? "—"}</td>
              <td className="mono">{p.sale_orders?.name ?? "—"}</td>
              <td>{p.payment_methods?.name ?? p.payment_methods?.code ?? "—"}</td>
              <td className="mono small">{p.reference ?? "—"}</td>
              <td className="right tabular-nums">{fmtEur(Number(p.amount ?? 0))}</td>
            </tr>
          ))}
          {(payments as any[]).length === 0 && (
            <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 12 }}>Sem recebimentos registados</td></tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className="right">TOTAL RECEBIDO</td>
            <td className="right tabular-nums">{fmtEur(total)}</td>
          </tr>
        </tfoot>
      </table>

      {byMethod.length > 0 && (
        <>
          <h2>Resumo por Método</h2>
          <table>
            <thead><tr><th>Método</th><th className="right">Total</th></tr></thead>
            <tbody>
              {byMethod.map(([k, v]) => (
                <tr key={k}><td>{k}</td><td className="right tabular-nums">{fmtEur(v)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="sig">
        <div className="line">Assinatura Motorista<br /><span className="muted small">{driver}</span></div>
        <div className="line">Conferido por (Caixa / Logística)</div>
      </div>
    </div>
  );
}
