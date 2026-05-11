import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const WEEKDAYS = [
  { v: 1, label: "Seg" }, { v: 2, label: "Ter" }, { v: 3, label: "Qua" },
  { v: 4, label: "Qui" }, { v: 5, label: "Sex" }, { v: 6, label: "Sáb" }, { v: 7, label: "Dom" },
];

export default function ZoneForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = !id || id === "new";

  const [form, setForm] = useState<any>({
    name: "",
    zip_from: "",
    zip_to: "",
    color: "#3b82f6",
    active: true,
    default_driver_id: null,
    default_vehicle_id: null,
    max_deliveries_per_day: 10,
    max_assembly_minutes_per_day: 240,
    weekdays: [1, 2, 3, 4, 5],
    notes: "",
  });

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const { data } = await supabase.from("delivery_zones").select("*").eq("id", id!).maybeSingle();
      if (data) setForm(data);
    })();
  }, [id, isNew]);

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles-min-zone"],
    queryFn: async () => (await supabase.from("vehicles").select("id,name,license_plate").eq("active", true).order("name")).data ?? [],
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers-min-zone"],
    queryFn: async () => {
      const { data: ug } = await supabase.from("user_groups").select("user_id, groups!inner(code)").eq("groups.code", "delivery_driver");
      const ids = (ug ?? []).map((r: any) => r.user_id);
      if (!ids.length) return [];
      const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      return data ?? [];
    },
  });

  const toggleDay = (v: number) => {
    setForm((f: any) => ({
      ...f,
      weekdays: f.weekdays.includes(v) ? f.weekdays.filter((x: number) => x !== v) : [...f.weekdays, v].sort(),
    }));
  };

  const save = async () => {
    if (!form.name || !form.zip_from || !form.zip_to) {
      return toast.error("Nome e códigos postais são obrigatórios");
    }
    const payload = { ...form };
    if (isNew) {
      delete payload.id;
      const { data, error } = await supabase.from("delivery_zones").insert(payload).select("id").single();
      if (error) return toast.error(error.message);
      toast.success("Zona criada");
      nav(`/routes/zones/${data.id}`);
    } else {
      const { error } = await supabase.from("delivery_zones").update(payload).eq("id", id!);
      if (error) return toast.error(error.message);
      toast.success("Zona atualizada");
    }
  };

  const remove = async () => {
    if (!confirm("Apagar esta zona? As rotas existentes serão também removidas.")) return;
    const { error } = await supabase.from("delivery_zones").delete().eq("id", id!);
    if (error) return toast.error(error.message);
    toast.success("Zona apagada");
    nav("/routes/zones");
  };

  return (
    <>
      <PageHeader
        title={isNew ? "Nova zona" : form.name || "Zona"}
        breadcrumb={[
          { label: "Rotas", to: "/routes" },
          { label: "Zonas", to: "/routes/zones" },
          { label: isNew ? "Nova" : form.name || "Editar" },
        ]}
        actions={
          <>
            {!isNew && <Button variant="destructive" size="sm" onClick={remove}>Apagar</Button>}
            <Button size="sm" onClick={save}>Guardar</Button>
          </>
        }
      />
      <PageBody>
        <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
          <Card className="p-4 space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Rota Porto" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>CP de</Label>
                <Input value={form.zip_from} onChange={(e) => setForm({ ...form, zip_from: e.target.value })} placeholder="4000" />
              </div>
              <div>
                <Label>CP até</Label>
                <Input value={form.zip_to} onChange={(e) => setForm({ ...form, zip_to: e.target.value })} placeholder="4999" />
              </div>
            </div>
            <div>
              <Label>Cor</Label>
              <Input type="color" value={form.color ?? "#3b82f6"} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-10 w-24 p-1" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              <Label>Zona ativa</Label>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div>
              <Label>Dias da semana</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.v}
                    type="button"
                    onClick={() => toggleDay(d.v)}
                    className={`px-3 py-1 rounded border text-sm ${form.weekdays.includes(d.v) ? "bg-primary text-primary-foreground border-primary" : "bg-card"}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Máx. entregas/dia</Label>
                <Input type="number" min={1} value={form.max_deliveries_per_day} onChange={(e) => setForm({ ...form, max_deliveries_per_day: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Máx. minutos montagem/dia</Label>
                <Input type="number" min={0} value={form.max_assembly_minutes_per_day} onChange={(e) => setForm({ ...form, max_assembly_minutes_per_day: Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <Label>Motorista padrão</Label>
              <Select value={form.default_driver_id ?? "none"} onValueChange={(v) => setForm({ ...form, default_driver_id: v === "none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Nenhum —</SelectItem>
                  {(drivers as any[]).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.full_name || d.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Carrinha padrão</Label>
              <Select value={form.default_vehicle_id ?? "none"} onValueChange={(v) => setForm({ ...form, default_vehicle_id: v === "none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Nenhuma —</SelectItem>
                  {(vehicles as any[]).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name} {v.license_plate ? `(${v.license_plate})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          <Card className="p-4 md:col-span-2">
            <Label>Notas</Label>
            <Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
          </Card>
        </div>
      </PageBody>
    </>
  );
}
