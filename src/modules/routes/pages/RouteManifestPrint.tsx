import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo } from "react";

// Print-friendly route manifest. Opens in a new tab and auto-triggers print.
export default function RouteManifestPrint() {
  const { id } = useParams();

  const { data: route } = useQuery({
    queryKey: ["route-print-detail", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("delivery_routes")
        .select("*, delivery_zones(name), vehicles(name,license_plate,volume_m3,usable_volume_m3,max_weight_kg)")
        .eq("id", id!).maybeSingle()).data,
  });

  const { data: capacity } = useQuery({
    queryKey: ["route-print-capacity", id],
    enabled: !!id,
    queryFn: async () => (await (supabase as any).rpc("delivery_route_capacity", { _route_id: id })).data,
  });

  const { data: routeOrders = [] } = useQuery<any[]>({
    queryKey: ["route-print-orders", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("delivery_route_orders")
        .select(`id, sequence, status, schedule_id,
                 delivery_schedules(sale_order_id, sale_orders(id, name, amount_total, payment_status,
                   partners(name, phone, street, city, zip)))`)
        .eq("route_id", id!).order("sequence")).data ?? [],
  });

  const { data: manifest = [] } = useQuery<any[]>({
    queryKey: ["route-print-manifest", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("vehicle_route_manifest")
        .select(`id, package_ref, package_sequence, package_total, product_id, qty_loaded,
                 weight_kg, length_cm, width_cm, height_cm, fragile, route_order_id,
                 products(name)`)
        .eq("route_id", id!)).data ?? [],
  });

  const { data: people = [] } = useQuery<any[]>({
    queryKey: ["route-print-people"],
    queryFn: async () => (await supabase.from("profiles").select("id,full_name")).data ?? [],
  });

  const { data: payments = [] } = useQuery<any[]>({
    queryKey: ["route-print-payments", id],
    enabled: !!id,
    queryFn: async () => {
      const orderIds = (routeOrders as any[])
        .map((o) => o?.delivery_schedules?.sale_order_id).filter(Boolean);
      if (!orderIds.length) return [];
      return (await supabase
        .from("customer_payments")
        .select("order_id, amount, state")
        .in("order_id", orderIds).eq("state", "posted")).data ?? [];
    },
  });

  const paidByOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments as any[]) m.set(p.order_id, (m.get(p.order_id) ?? 0) + Number(p.amount ?? 0));
    return m;
  }, [payments]);

  const manifestByOrder = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const row of manifest as any[]) {
      const arr = m.get(row.route_order_id) ?? [];
      arr.push(row);
      m.set(row.route_order_id, arr);
    }
    return m;
  }, [manifest]);

  useEffect(() => {
    if (route && routeOrders.length >= 0 && manifest.length >= 0) {
      const t = setTimeout(() => window.print(), 500);
      return () => clearTimeout(t);
    }
  }, [route, routeOrders.length, manifest.length]);

  if (!route) return <div style={{ padding: 24 }}>A carregar…</div>;

  const r: any = route;
  const driver = (people as any[]).find((p) => p.id === r.driver_id)?.full_name ?? "—";
  const helper = (people as any[]).find((p) => p.id === r.helper_id)?.full_name ?? "—";
  const veh = r.vehicles ?? {};
  const cap: any = capacity ?? {};

  const fmtEur = (n: number) => Number(n || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

  const totalExpected = (routeOrders as any[]).reduce(
    (a, o) => a + Number(o?.delivery_schedules?.sale_orders?.amount_total ?? 0), 0);
  const totalToCollect = (routeOrders as any[]).reduce((a, o) => {
    const tot = Number(o?.delivery_schedules?.sale_orders?.amount_total ?? 0);
    const paid = paidByOrder.get(o?.delivery_schedules?.sale_order_id) ?? 0;
    return a + Math.max(0, tot - paid);
  }, 0);

  const totalColis = (manifest as any[]).reduce((a, m) => a + Number(m.qty_loaded ?? 0), 0);
  const totalProducts = new Set((manifest as any[]).map((m) => m.product_id)).size;

  return (
    <div className="manifest-print">
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          html, body { background: white !important; }
          .no-print { display: none !important; }
        }
        .manifest-print { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color: #111; padding: 20px; max-width: 900px; margin: 0 auto; font-size: 12px; }
        .manifest-print h1 { font-size: 20px; margin: 0 0 4px; }
        .manifest-print h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 1px solid #333; padding-bottom: 2px; }
        .manifest-print .row { display:flex; justify-content: space-between; gap: 16px; }
        .manifest-print table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .manifest-print th, .manifest-print td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; }
        .manifest-print th { background: #f0f0f0; }
        .manifest-print .stat { border: 1px solid #999; padding: 6px 8px; flex: 1; }
        .manifest-print .stat .lbl { font-size: 10px; color: #555; text-transform: uppercase; }
        .manifest-print .stat .val { font-size: 16px; font-weight: 600; }
        .manifest-print .sig { margin-top: 28px; display: flex; gap: 32px; }
        .manifest-print .sig .line { flex: 1; border-top: 1px solid #000; padding-top: 4px; font-size: 11px; text-align: center; }
        .manifest-print .customer { border: 1px solid #999; padding: 8px; margin-bottom: 8px; page-break-inside: avoid; }
        .manifest-print .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .manifest-print .muted { color: #555; }
        .manifest-print .small { font-size: 10px; }
      `}</style>

      <button className="no-print" onClick={() => window.print()} style={{ marginBottom: 12, padding: "6px 12px" }}>
        Imprimir
      </button>

      <header className="row" style={{ alignItems: "flex-start" }}>
        <div>
          <h1>Manifesto de Rota</h1>
          <div className="muted">{r.delivery_zones?.name ?? "—"} · {r.route_date}</div>
          <div className="small mono">ID: {r.id}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div><strong>Viatura:</strong> {veh.name ?? "—"} {veh.license_plate ? `(${veh.license_plate})` : ""}</div>
          <div><strong>Motorista:</strong> {driver}</div>
          <div><strong>Ajudante:</strong> {helper}</div>
          <div className="small muted">Impresso em {new Date().toLocaleString("pt-PT")}</div>
        </div>
      </header>

      <h2>Resumo</h2>
      <div className="row">
        <div className="stat"><div className="lbl">Entregas</div><div className="val">{(routeOrders as any[]).length}</div></div>
        <div className="stat"><div className="lbl">Colis carregados</div><div className="val">{totalColis}</div></div>
        <div className="stat"><div className="lbl">Produtos</div><div className="val">{totalProducts}</div></div>
        <div className="stat">
          <div className="lbl">M³ viatura</div>
          <div className="val">{Number(veh.usable_volume_m3 ?? veh.volume_m3 ?? 0).toFixed(2)}</div>
          <div className="small muted">Ocupado: {Number(cap.current_volume_m3 ?? 0).toFixed(2)} m³</div>
        </div>
        <div className="stat">
          <div className="lbl">A receber</div>
          <div className="val">{fmtEur(totalToCollect)}</div>
          <div className="small muted">Previsto: {fmtEur(totalExpected)}</div>
        </div>
      </div>

      <h2>Entregas de Clientes</h2>
      {(routeOrders as any[]).map((o, idx) => {
        const so = o?.delivery_schedules?.sale_orders;
        const partner = so?.partners ?? {};
        const items = manifestByOrder.get(o.id) ?? [];
        const expected = Number(so?.amount_total ?? 0);
        const paid = paidByOrder.get(o?.delivery_schedules?.sale_order_id) ?? 0;
        const toCollect = Math.max(0, expected - paid);
        return (
          <div key={o.id} className="customer">
            <div className="row" style={{ marginBottom: 4 }}>
              <div>
                <strong>#{o.sequence ?? idx + 1} · {partner.name ?? "—"}</strong>
                <div className="small">{[partner.street, partner.zip, partner.city].filter(Boolean).join(", ") || "Sem morada"}</div>
                {partner.phone && <div className="small muted">Tel: {partner.phone}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="small mono">{so?.name ?? ""}</div>
                <div><strong>{fmtEur(expected)}</strong></div>
                {toCollect > 0 ? <div className="small">A receber: <strong>{fmtEur(toCollect)}</strong></div>
                  : <div className="small muted">Pago</div>}
              </div>
            </div>
            {items.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "55%" }}>Produto</th>
                    <th>Colis</th>
                    <th>Qtd</th>
                    <th>Peso (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it: any) => (
                    <tr key={it.id}>
                      <td>{it.products?.name ?? "—"} {it.fragile && <span className="small">⚠ frágil</span>}</td>
                      <td>{it.package_ref ?? (it.package_sequence ? `${it.package_sequence}/${it.package_total ?? ""}` : "—")}</td>
                      <td>{Number(it.qty_loaded ?? 0)}</td>
                      <td>{Number(it.weight_kg ?? 0).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      <div className="sig">
        <div className="line">Assinatura do Motorista<br /><span className="muted small">{driver}</span></div>
        <div className="line">Data / Hora</div>
      </div>
    </div>
  );
}
