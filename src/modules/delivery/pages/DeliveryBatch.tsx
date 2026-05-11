import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, CheckCircle2, MapPin, ChevronRight } from "lucide-react";

export default function DeliveryBatch() {
  const { id } = useParams();
  const [batch, setBatch] = useState<any>(null);
  const [pickings, setPickings] = useState<any[]>([]);

  const load = async () => {
    const { data: b } = await supabase
      .from("stock_picking_batches")
      .select("id, name, delivery_date, vehicles(name, license_plate)")
      .eq("id", id!)
      .maybeSingle();
    setBatch(b);
    const { data: ps } = await supabase
      .from("stock_pickings")
      .select("id, name, state, origin, partners(name, street, city)")
      .eq("batch_id", id!)
      .eq("kind", "outgoing")
      .order("name");
    setPickings(ps ?? []);
  };
  useEffect(() => { if (id) load(); }, [id]);

  return (
    <div className="p-4 space-y-3">
      <Link to="/delivery" className="inline-flex items-center text-sm text-slate-400 hover:text-slate-200">
        <ChevronLeft className="h-4 w-4" /> Voltar
      </Link>
      {batch && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="font-semibold text-lg">{batch.name}</div>
          <div className="text-xs text-slate-400">
            {batch.vehicles?.name} {batch.vehicles?.license_plate ? `· ${batch.vehicles.license_plate}` : ""} · {batch.delivery_date ?? ""}
          </div>
        </div>
      )}
      <div className="text-xs uppercase tracking-wider text-slate-500 pt-2">
        Entregas ({pickings.filter((p) => p.state === "done").length}/{pickings.length})
      </div>
      {pickings.map((p) => {
        const done = p.state === "done";
        return (
          <Link key={p.id} to={`/delivery/picking/${p.id}`}
            className={`block border rounded-lg p-4 ${done ? "bg-emerald-950/40 border-emerald-900" : "bg-slate-900 border-slate-800 hover:bg-slate-800"}`}>
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  {done && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                  {p.partners?.name ?? "Cliente"}
                </div>
                <div className="text-xs text-slate-400 truncate flex items-center gap-1 mt-1">
                  <MapPin className="h-3 w-3" /> {p.partners?.street ?? "—"} {p.partners?.city ? `· ${p.partners.city}` : ""}
                </div>
                <div className="text-xs text-slate-500 mt-1">{p.name} · {p.origin ?? ""}</div>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-500 shrink-0" />
            </div>
          </Link>
        );
      })}
      {pickings.length === 0 && (
        <div className="text-center py-8 text-slate-500 text-sm">Sem entregas neste lote.</div>
      )}
    </div>
  );
}
