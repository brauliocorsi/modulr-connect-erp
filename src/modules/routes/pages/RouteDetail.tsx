import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Truck, User2, Calendar, Trash2, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function RouteDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();

  const { data: route } = useQuery({
    queryKey: ["route-detail", id],
    queryFn: async () =>
      (await supabase
        .from("delivery_routes")
        .select("*, delivery_zones(name,color,zip_from,zip_to), vehicles(name,license_plate)")
        .eq("id", id!).maybeSingle()).data,
    enabled: !!id,
  });

  const { data: pickings = [] } = useQuery({
    queryKey: ["route-pickings", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase
        .from("stock_pickings")
        .select("id,name,state,scheduled_at,origin,partners(name,zip,city)")
        .eq("route_id", id!)
        .order("scheduled_at", { ascending: true })).data ?? [],
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers-route"],
    queryFn: async () => {
      const { data: ug } = await supabase.from("user_groups").select("user_id, groups!inner(code)").eq("groups.code", "delivery_driver");
      const ids = (ug ?? []).map((r: any) => r.user_id);
      if (!ids.length) return [];
      const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      return data ?? [];
    },
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles-route"],
    queryFn: async () => (await supabase.from("vehicles").select("id,name,license_plate").eq("active", true).order("name")).data ?? [],
  });

  const { data: zones = [] } = useQuery({
    queryKey: ["zones-route-edit"],
    queryFn: async () => (await supabase.from("delivery_zones").select("id,name,zip_from,zip_to").eq("active", true).order("name")).data ?? [],
  });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  useEffect(() => {
    if (route) setForm({
      driver_id: route.driver_id, vehicle_id: route.vehicle_id,
      max_deliveries: route.max_deliveries, max_assembly_minutes: route.max_assembly_minutes,
      state: route.state, notes: route.notes,
      route_date: route.route_date, zone_id: route.zone_id,
    });
  }, [route]);

  const save = async () => {
    const { error } = await supabase.from("delivery_routes").update(form).eq("id", id!);
    if (error) return toast.error(error.message);
    toast.success("Rota atualizada");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["route-detail", id] });
    qc.invalidateQueries({ queryKey: ["routes-schedule"] });
  };

  const remove = async () => {
    if (!confirm("Apagar esta rota? As entregas atribuídas ficarão sem rota.")) return;
    const { error } = await supabase.from("delivery_routes").delete().eq("id", id!);
    if (error) return toast.error(error.message);
    toast.success("Rota apagada");
    qc.invalidateQueries({ queryKey: ["routes-schedule"] });
    nav("/routes");
  };

  if (!route) return <PageBody>Carregando…</PageBody>;
  const r: any = route;

  return (
    <>
      <PageHeader
        title={`${r.delivery_zones?.name ?? "Rota"} · ${r.route_date}`}
        breadcrumb={[{ label: "Rotas", to: "/routes" }, { label: r.route_date }]}
        actions={
          editing ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
              <Button size="sm" onClick={save}>Guardar</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="destructive" onClick={remove}><Trash2 className="h-4 w-4 mr-1" />Apagar</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Editar</Button>
            </>
          )
        }
      />
      <PageBody>
        <div className="grid gap-3 md:grid-cols-3 mb-4">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Estado</div>
            {editing ? (
              <Select value={form.state} onValueChange={(v) => setForm({ ...form, state: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Planeada</SelectItem>
                  <SelectItem value="in_progress">Em curso</SelectItem>
                  <SelectItem value="done">Concluída</SelectItem>
                  <SelectItem value="cancelled">Cancelada</SelectItem>
                </SelectContent>
              </Select>
            ) : <Badge className="mt-1 capitalize">{r.state}</Badge>}
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><User2 className="h-3 w-3" />Motorista</div>
            {editing ? (
              <Select value={form.driver_id ?? "none"} onValueChange={(v) => setForm({ ...form, driver_id: v === "none" ? null : v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {(drivers as any[]).map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name || d.email}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : <div className="mt-1">{(drivers as any[]).find((d) => d.id === r.driver_id)?.full_name ?? "—"}</div>}
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Truck className="h-3 w-3" />Carrinha</div>
            {editing ? (
              <Select value={form.vehicle_id ?? "none"} onValueChange={(v) => setForm({ ...form, vehicle_id: v === "none" ? null : v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {(vehicles as any[]).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : <div className="mt-1">{r.vehicles?.name ?? "—"}</div>}
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Capacidade</div>
            {editing ? (
              <div className="grid grid-cols-2 gap-2 mt-1">
                <Input type="number" value={form.max_deliveries} onChange={(e) => setForm({ ...form, max_deliveries: Number(e.target.value) })} />
                <Input type="number" value={form.max_assembly_minutes} onChange={(e) => setForm({ ...form, max_assembly_minutes: Number(e.target.value) })} />
              </div>
            ) : (
              <div className="mt-1 text-sm">
                {pickings.length}/{r.max_deliveries} entregas · {r.max_assembly_minutes} min
              </div>
            )}
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />Data</div>
            {editing ? (
              <Input type="date" className="mt-1" value={form.route_date ?? ""} onChange={(e) => setForm({ ...form, route_date: e.target.value })} />
            ) : <div className="mt-1 text-sm">{r.route_date}</div>}
          </Card>
          <Card className="p-3 md:col-span-2">
            <div className="text-xs text-muted-foreground">Zona</div>
            {editing ? (
              <Select value={form.zone_id} onValueChange={(v) => setForm({ ...form, zone_id: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(zones as any[]).map((z) => (
                    <SelectItem key={z.id} value={z.id}>{z.name} · {z.zip_from}–{z.zip_to}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="mt-1 text-sm">
                {r.delivery_zones?.name} · CP {r.delivery_zones?.zip_from}–{r.delivery_zones?.zip_to}
              </div>
            )}
          </Card>
          <Card className="p-3 md:col-span-3">
            <Label className="text-xs text-muted-foreground">Notas</Label>
            {editing ? (
              <Input className="mt-1" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            ) : <div className="mt-1 text-sm">{r.notes || "—"}</div>}
          </Card>
        </div>

        <Card>
          <div className="px-3 py-2 border-b font-semibold text-sm">Entregas atribuídas</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-3 py-2">Transferência</th>
                <th className="text-left px-3 py-2">Cliente</th>
                <th className="text-left px-3 py-2">CP / Cidade</th>
                <th className="text-left px-3 py-2">Origem</th>
                <th className="text-left px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(pickings as any[]).length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Sem entregas atribuídas</td></tr>
              ) : (pickings as any[]).map((p) => (
                <tr key={p.id} className="border-t hover:bg-accent/30">
                  <td className="px-3 py-2">
                    <Link to={`/inventory/transfers/${p.id}`} className="text-primary hover:underline">{p.name}</Link>
                  </td>
                  <td className="px-3 py-2">{p.partners?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{p.partners?.zip ?? ""} {p.partners?.city ?? ""}</td>
                  <td className="px-3 py-2 text-xs">{p.origin ?? "—"}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="capitalize">{p.state}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </PageBody>
    </>
  );
}
