import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ShoppingBag, ShoppingCart, Truck, PackageCheck, Boxes, ArrowRight } from "lucide-react";

type Stat = {
  label: string;
  count: number;
  to?: string;
  icon: any;
  tone?: "default" | "success" | "warning" | "info";
  hint?: string;
};

function Btn({ s }: { s: Stat }) {
  const Icon = s.icon;
  const toneCls =
    s.tone === "success" ? "text-emerald-600"
    : s.tone === "warning" ? "text-amber-600"
    : s.tone === "info" ? "text-blue-600"
    : "text-foreground";
  const Wrapper: any = s.to && s.count > 0 ? Link : "div";
  const props: any = s.to && s.count > 0 ? { to: s.to } : {};
  return (
    <Wrapper {...props} className="block">
      <Card className={`p-3 hover:bg-accent transition-colors ${s.to && s.count > 0 ? "cursor-pointer" : "opacity-70"}`}>
        <div className="flex items-center gap-3">
          <Icon className={`h-5 w-5 ${toneCls}`} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-lg font-semibold leading-tight">{s.count}</div>
            {s.hint && <div className="text-[10px] text-muted-foreground truncate">{s.hint}</div>}
          </div>
          {s.to && s.count > 0 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </Card>
    </Wrapper>
  );
}

export function SmartButtons({
  kind,
  orderName,
}: {
  kind: "sale" | "purchase" | "picking";
  orderName: string;
}) {
  const [stats, setStats] = useState<Stat[]>([]);

  useEffect(() => {
    if (!orderName) return;
    (async () => {
      if (kind === "sale") {
        // Outgoing pickings linked to SO
        const { data: outs } = await supabase
          .from("stock_pickings")
          .select("id,name,state,kind")
          .eq("origin", orderName);
        // POs linked to SO
        const { data: pos } = await supabase
          .from("purchase_orders")
          .select("id,name,state")
          .eq("origin", orderName);
        const poNames = (pos ?? []).map((p) => p.name);
        // Receipts from those POs
        let receipts: any[] = [];
        if (poNames.length) {
          const { data } = await supabase
            .from("stock_pickings")
            .select("id,name,state")
            .in("origin", poNames);
          receipts = data ?? [];
        }
        const deliveries = (outs ?? []).filter((p) => p.kind === "outgoing");
        const doneDeliv = deliveries.filter((p) => p.state === "done").length;
        const donePos = (pos ?? []).filter((p) => ["confirmed", "done"].includes(p.state)).length;
        const doneRecv = receipts.filter((p) => p.state === "done").length;
        setStats([
          {
            label: "Entregas",
            count: deliveries.length,
            to: deliveries[0] ? `/inventory/transfers/${deliveries[0].id}` : undefined,
            icon: Truck,
            tone: doneDeliv === deliveries.length && deliveries.length > 0 ? "success" : "info",
            hint: deliveries.length ? `${doneDeliv}/${deliveries.length} concluídas` : "—",
          },
          {
            label: "Compras geradas",
            count: pos?.length ?? 0,
            to: pos && pos[0] ? `/purchase/orders/${pos[0].id}` : undefined,
            icon: ShoppingBag,
            tone: donePos === (pos?.length ?? 0) && (pos?.length ?? 0) > 0 ? "success" : "warning",
            hint: pos?.length ? `${donePos}/${pos.length} confirmadas` : "—",
          },
          {
            label: "Recebimentos",
            count: receipts.length,
            to: receipts[0] ? `/inventory/transfers/${receipts[0].id}` : undefined,
            icon: PackageCheck,
            tone: doneRecv === receipts.length && receipts.length > 0 ? "success" : "info",
            hint: receipts.length ? `${doneRecv}/${receipts.length} recebidos` : "—",
          },
        ]);
      } else if (kind === "purchase") {
        // Receipts (incoming pickings) linked to PO
        const { data: recv } = await supabase
          .from("stock_pickings")
          .select("id,name,state,kind")
          .eq("origin", orderName);
        // Source SOs — primary via purchase_order_origins (multiple, supports merged POs), fallback to po.origin
        const { data: po } = await supabase
          .from("purchase_orders")
          .select("id,origin")
          .eq("name", orderName)
          .maybeSingle();
        let sos: { id: string; name: string; state: string }[] = [];
        if (po?.id) {
          const { data: origins } = await supabase
            .from("purchase_order_origins")
            .select("sale_order_id, sale_orders(id,name,state)")
            .eq("po_id", po.id);
          sos = (origins ?? [])
            .map((o: any) => o.sale_orders)
            .filter(Boolean);
        }
        if (sos.length === 0 && po?.origin) {
          const r = await supabase.from("sale_orders").select("id,name,state").eq("name", po.origin).maybeSingle();
          if (r.data) sos = [r.data];
        }
        const doneRecv = (recv ?? []).filter((p) => p.state === "done").length;
        const firstSo = sos[0];
        setStats([
          {
            label: "Recebimentos",
            count: recv?.length ?? 0,
            to: recv && recv[0] ? `/inventory/transfers/${recv[0].id}` : undefined,
            icon: PackageCheck,
            tone: doneRecv === (recv?.length ?? 0) && (recv?.length ?? 0) > 0 ? "success" : "info",
            hint: recv?.length ? `${doneRecv}/${recv.length} recebidos` : "—",
          },
          {
            label: sos.length > 1 ? "Vendas de origem" : "Venda de origem",
            count: sos.length,
            to: firstSo ? `/sales/orders/${firstSo.id}` : undefined,
            icon: ShoppingCart,
            tone: "info",
            hint: sos.length === 0
              ? "Nenhuma"
              : sos.length === 1
                ? `${firstSo.name} (${firstSo.state})`
                : sos.map((s) => s.name).join(", "),
          },
        ]);
      } else {
        // picking: try to find source doc by origin
        const { data: pk } = await supabase.from("stock_pickings").select("origin,kind").eq("name", orderName).maybeSingle();
        const origin = pk?.origin;
        let so: any = null, po: any = null, moves = 0;
        if (origin) {
          const r1 = await supabase.from("sale_orders").select("id,name,state").eq("name", origin).maybeSingle();
          so = r1.data;
          const r2 = await supabase.from("purchase_orders").select("id,name,state").eq("name", origin).maybeSingle();
          po = r2.data;
        }
        const { count } = await supabase
          .from("stock_moves")
          .select("id", { count: "exact", head: true })
          .eq("reference", origin ?? "__none__");
        moves = count ?? 0;
        setStats([
          {
            label: "Venda de origem",
            count: so ? 1 : 0,
            to: so ? `/sales/orders/${so.id}` : undefined,
            icon: ShoppingCart,
            tone: "info",
            hint: so ? `${so.name} (${so.state})` : "—",
          },
          {
            label: "Compra de origem",
            count: po ? 1 : 0,
            to: po ? `/purchase/orders/${po.id}` : undefined,
            icon: ShoppingBag,
            tone: "info",
            hint: po ? `${po.name} (${po.state})` : "—",
          },
          {
            label: "Movimentos relacionados",
            count: moves,
            to: `/inventory/moves?origin=${encodeURIComponent(origin ?? "")}`,
            icon: Boxes,
            tone: "default",
            hint: origin ?? "—",
          },
        ]);
      }
    })();
  }, [kind, orderName]);

  if (!stats.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {stats.map((s, i) => <Btn key={i} s={s} />)}
    </div>
  );
}
