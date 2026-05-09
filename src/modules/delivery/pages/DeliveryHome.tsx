import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { Truck, Package, ChevronRight } from "lucide-react";

export default function DeliveryHome() {
  const { user } = useAuth();
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("stock_picking_batches")
        .select("id, name, state, delivery_date, vehicles(name, license_plate)")
        .eq("driver_id", user.id)
        .neq("state", "done")
        .neq("state", "cancelled")
        .order("delivery_date", { ascending: true });
      setBatches(data ?? []);
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="p-4 space-y-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">Os meus lotes</div>
      {loading && <div className="text-slate-500 text-sm">A carregar…</div>}
      {!loading && batches.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          <Truck className="h-10 w-10 mx-auto mb-2 opacity-40" />
          Sem lotes atribuídos hoje.
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
    </div>
  );
}
