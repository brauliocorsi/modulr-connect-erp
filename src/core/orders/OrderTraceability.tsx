import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Circle, Clock, ShoppingBag, Truck, Package, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

type Ev = {
  ts?: string | null;
  icon: any;
  done: boolean;
  title: string;
  meta?: string;
  link?: string;
};

export function OrderTraceability({ saleOrderId }: { saleOrderId: string }) {
  const { data } = useQuery({
    queryKey: ["traceability", saleOrderId],
    queryFn: async () => {
      const { data: so } = await supabase
        .from("sale_orders")
        .select("id,name,state,date_order,warehouse_id,partner_id, partners(name), warehouses(name)")
        .eq("id", saleOrderId).maybeSingle();
      if (!so) return null;
      const [{ data: pos }, { data: pickings }] = await Promise.all([
        supabase.from("purchase_orders").select("id,name,state,date_order,expected_date, partners(name)").eq("origin", so.name),
        supabase.from("stock_pickings").select("id,name,kind,state,scheduled_at,done_at,origin").or(`origin.eq.${so.name}`),
      ]);
      // also fetch pickings linked to the POs
      let poPickings: any[] = [];
      if (pos && pos.length) {
        const { data: pp } = await supabase
          .from("stock_pickings")
          .select("id,name,kind,state,scheduled_at,done_at,origin")
          .in("origin", pos.map((p: any) => p.name));
        poPickings = pp ?? [];
      }
      return { so, pos: pos ?? [], pickings: pickings ?? [], poPickings };
    },
  });

  if (!data) return <Card className="p-4 text-sm text-muted-foreground">Carregando rastreio…</Card>;
  const { so, pos, pickings, poPickings } = data;

  const events: Ev[] = [];
  events.push({
    ts: so.date_order, icon: CheckCircle2, done: true,
    title: `Pedido criado · ${so.name}`,
    meta: `Cliente: ${(so as any).partners?.name ?? "—"} · Armazém: ${(so as any).warehouses?.name ?? "—"}`,
  });
  if (so.state !== "draft" && so.state !== "sent") {
    events.push({ ts: so.date_order, icon: CheckCircle2, done: true, title: "Pedido confirmado" });
  }

  for (const po of pos as any[]) {
    events.push({
      ts: po.date_order, icon: ShoppingBag, done: true,
      title: `Compra criada · ${po.name}`,
      meta: `Fornecedor: ${po.partners?.name ?? "—"}${po.expected_date ? ` · previsto ${new Date(po.expected_date).toLocaleDateString("pt-PT")}` : ""}`,
      link: `/purchase/orders/${po.id}`,
    });
    if (po.state === "confirmed" || po.state === "done") {
      events.push({ ts: po.date_order, icon: CheckCircle2, done: true, title: `Compra confirmada · ${po.name}`, link: `/purchase/orders/${po.id}` });
    }
    const linked = poPickings.filter((p: any) => p.origin === po.name);
    for (const pk of linked) {
      events.push({
        ts: pk.done_at ?? pk.scheduled_at, icon: ArrowDownToLine, done: pk.state === "done",
        title: `Recebimento ${pk.name}`,
        meta: `Estado: ${pk.state}`,
        link: `/inventory/transfers/${pk.id}`,
      });
    }
  }

  for (const pk of pickings as any[]) {
    events.push({
      ts: pk.scheduled_at, icon: pk.kind === "outgoing" ? ArrowUpFromLine : Package, done: pk.state === "done",
      title: `${pk.kind === "outgoing" ? "Entrega" : "Transferência"} ${pk.name}`,
      meta: `Estado: ${pk.state}${pk.scheduled_at ? ` · agendado ${new Date(pk.scheduled_at).toLocaleString("pt-PT")}` : ""}`,
      link: `/inventory/transfers/${pk.id}`,
    });
    if (pk.state !== "done") {
      events.push({ ts: null, icon: Truck, done: false, title: "Entrega ao cliente pendente" });
    } else {
      events.push({ ts: pk.done_at, icon: CheckCircle2, done: true, title: "Entregue ao cliente" });
    }
  }

  events.sort((a, b) => {
    const ta = a.ts ? new Date(a.ts).getTime() : Infinity;
    const tb = b.ts ? new Date(b.ts).getTime() : Infinity;
    return ta - tb;
  });

  return (
    <Card className="p-5">
      <div className="o-section-title mb-4">Rastreio do pedido</div>
      <ol className="relative border-l border-border ml-3 space-y-4">
        {events.map((e, i) => {
          const Icon = e.done ? e.icon : Circle;
          return (
            <li key={i} className="ml-6">
              <span className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-background ${e.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="flex flex-wrap items-baseline gap-2">
                {e.link ? (
                  <Link to={e.link} className="font-medium hover:underline">{e.title}</Link>
                ) : (
                  <span className="font-medium">{e.title}</span>
                )}
                {e.ts && (
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(e.ts).toLocaleString("pt-PT")}
                  </span>
                )}
              </div>
              {e.meta && <div className="text-xs text-muted-foreground mt-0.5">{e.meta}</div>}
            </li>
          );
        })}
        {events.length === 0 && <li className="ml-6 text-sm text-muted-foreground">Sem eventos ainda.</li>}
      </ol>
    </Card>
  );
}
