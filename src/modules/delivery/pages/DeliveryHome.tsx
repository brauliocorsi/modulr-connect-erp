import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Truck, Package, ChevronRight, MapPin } from "lucide-react";

export default function DeliveryHome() {
  const { user } = useAuth();
  const [batches, setBatches] = useState<any[]>([]);
  const [pickings, setPickings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: bs }, { data: pks }] = await Promise.all([
        supabase
          .from("stock_picking_batches")
          .select("id, name, state, delivery_date, vehicles(name, license_plate)")
          .eq("driver_id", user.id)
          .neq("state", "done")
          .neq("state", "cancelled")
          .order("delivery_date", { ascending: true }),
        supabase
          .from("stock_pickings")
          .select("id, name, state, scheduled_at, origin, partners(name, city)")
          .like("step_label", "Entrega (Em Entrega%")
          .in("state", ["waiting", "ready", "in_progress"] as any)
          .is("batch_id", null)
          .order("scheduled_at", { ascending: true }),
      ]);
      setBatches(bs ?? []);
      setPickings(pks ?? []);
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="p-4 space-y-6">
      <section className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-slate-500">Os meus lotes</div>
        {loading && <div className="text-slate-500 text-sm">A carregar…</div>}
        {!loading && batches.length === 0 && (
          <div className="text-center py-6 text-slate-500 text-sm">
            <Truck className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Sem lotes atribuídos.
          </div>
        )}
        {batches.map((b) => (
          <Link key={b.id} to={`/delivery/batch/${b.id}`}
            className="block bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4 text-emerald-400" /> {b.name}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {b.vehicles?.name ?? "—"} {b.vehicles?.license_plate ? `· ${b.vehicles.license_plate}` : ""}
                  {b.delivery_date ? ` · ${b.delivery_date}` : ""}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-500" />
            </div>
          </Link>
        ))}
      </section>

      <section className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-slate-500">Entregas disponíveis</div>
        {!loading && pickings.length === 0 && (
          <div className="text-center py-6 text-slate-500 text-sm">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Nenhuma entrega em curso.
          </div>
        )}
        {pickings.map((p) => (
          <Link key={p.id} to={`/delivery/picking/${p.id}`}
            className="block bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold flex items-center gap-2">
                  <Truck className="h-4 w-4 text-emerald-400" /> {p.name}
                  {p.origin && <span className="text-xs text-slate-400 font-normal">· {p.origin}</span>}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {p.partners?.name ?? "—"}{p.partners?.city ? ` · ${p.partners.city}` : ""}
                  {p.scheduled_at ? ` · ${new Date(p.scheduled_at).toLocaleDateString("pt-PT")}` : ""}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-500" />
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
