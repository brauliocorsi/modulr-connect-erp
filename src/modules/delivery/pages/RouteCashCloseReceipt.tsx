/**
 * F29 Bloco 2 — Comprovante de fecho (impressão)
 * Rota: /delivery/routes/:routeId/cash-close/receipt
 */
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const fmtEUR = (n: number | null | undefined) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(n ?? 0));

export default function RouteCashCloseReceipt() {
  const { routeId } = useParams<{ routeId: string }>();

  const q = useQuery({
    queryKey: ["receipt", routeId],
    enabled: !!routeId,
    queryFn: async () => {
      const [route, closure] = await Promise.all([
        supabase
          .from("delivery_routes")
          .select("route_date,driver:hr_employees!delivery_routes_driver_id_fkey(full_name),vehicle:vehicles(name,license_plate),zone:delivery_zones(name)")
          .eq("id", routeId!)
          .maybeSingle(),
        supabase
          .from("delivery_route_cash_closure")
          .select("*")
          .eq("route_id", routeId!)
          .maybeSingle(),
      ]);
      if (route.error) throw route.error;
      if (closure.error) throw closure.error;
      return { route: route.data as any, closure: closure.data as any };
    },
  });

  useEffect(() => {
    if (q.data) setTimeout(() => window.print(), 400);
  }, [q.data]);

  if (q.isLoading || !q.data?.closure) {
    return <div className="p-6">A carregar…</div>;
  }

  const { route, closure } = q.data;
  const exp = closure.expected_cash + closure.expected_mbway + closure.expected_transfer + closure.expected_other;
  const real = closure.actual_cash + closure.actual_mbway + closure.actual_transfer + closure.actual_other;

  return (
    <div className="p-8 max-w-2xl mx-auto bg-white text-black text-sm print:p-4">
      <h1 className="text-xl font-bold mb-1">Comprovante de Fecho de Caixa</h1>
      <p className="text-xs text-gray-600 mb-4">Rota de entrega · UP Móveis</p>

      <table className="w-full mb-4 text-xs">
        <tbody>
          <tr><td className="py-1 text-gray-600">Data da rota</td><td className="font-medium">{new Date(route.route_date).toLocaleDateString("pt-PT")}</td></tr>
          <tr><td className="py-1 text-gray-600">Zona</td><td>{route.zone?.name ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Entregador</td><td className="font-medium">{route.driver?.full_name ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Veículo</td><td>{route.vehicle?.name ?? route.vehicle?.license_plate ?? "—"}</td></tr>
          <tr><td className="py-1 text-gray-600">Fechada em</td><td>{closure.closed_at ? new Date(closure.closed_at).toLocaleString("pt-PT") : "—"}</td></tr>
        </tbody>
      </table>

      <table className="w-full border-collapse text-xs mb-6">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="text-left py-1.5">Método</th>
            <th className="text-right py-1.5">Esperado</th>
            <th className="text-right py-1.5">Real</th>
            <th className="text-right py-1.5">Variância</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["Dinheiro", closure.expected_cash, closure.actual_cash],
            ["MB Way", closure.expected_mbway, closure.actual_mbway],
            ["Multibanco/Transferência", closure.expected_transfer, closure.actual_transfer],
            ["Outros", closure.expected_other, closure.actual_other],
          ].map(([k, e, a]) => (
            <tr key={k as string} className="border-b">
              <td className="py-1">{k}</td>
              <td className="text-right tabular-nums">{fmtEUR(e as number)}</td>
              <td className="text-right tabular-nums">{fmtEUR(a as number)}</td>
              <td className="text-right tabular-nums">{fmtEUR((a as number) - (e as number))}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-black font-bold">
            <td className="py-1.5">TOTAL</td>
            <td className="text-right tabular-nums">{fmtEUR(exp)}</td>
            <td className="text-right tabular-nums">{fmtEUR(real)}</td>
            <td className="text-right tabular-nums">{fmtEUR(closure.variance)}</td>
          </tr>
        </tbody>
      </table>

      {closure.notes && (
        <div className="mb-6">
          <div className="text-xs text-gray-600 mb-1">Notas</div>
          <div className="border p-2 rounded text-xs whitespace-pre-wrap">{closure.notes}</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-8 mt-12">
        <div>
          <div className="border-t border-black pt-1 text-xs text-center">Assinatura do entregador</div>
        </div>
        <div>
          <div className="border-t border-black pt-1 text-xs text-center">Assinatura do responsável</div>
        </div>
      </div>

      <div className="mt-8 text-[10px] text-gray-500 text-center print:hidden">
        <button onClick={() => window.print()} className="underline">Imprimir novamente</button>
      </div>
    </div>
  );
}
