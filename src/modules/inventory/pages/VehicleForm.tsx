import { useEffect, useState } from "react";
import { SimpleForm } from "@/core/layout/SimpleForm";
import { supabase } from "@/integrations/supabase/client";

export default function VehicleForm() {
  const [drivers, setDrivers] = useState<{ value: string; label: string }[]>([]);
  const [registers, setRegisters] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    (async () => {
      // Drivers = users in delivery_driver group
      const { data: ug } = await supabase
        .from("user_groups")
        .select("user_id, groups!inner(code)")
        .eq("groups.code", "delivery_driver");
      const ids = (ug ?? []).map((r: any) => r.user_id);
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
        setDrivers((profs ?? []).map((p: any) => ({ value: p.id, label: p.full_name || p.email })));
      }
      const { data: regs } = await supabase.from("cash_registers").select("id, name").eq("active", true).order("name");
      setRegisters((regs ?? []).map((r: any) => ({ value: r.id, label: r.name })));
    })();
  }, []);

  return (
    <SimpleForm
      table="vehicles"
      title="Carrinha / Veículo"
      basePath="/inventory/vehicles"
      breadcrumb={[
        { label: "Inventário", to: "/inventory" },
        { label: "Carrinhas", to: "/inventory/vehicles" },
        { label: "Editar" },
      ]}
      fields={[
        { name: "name", label: "Nome (ex: VAN-01)", required: true },
        { name: "license_plate", label: "Matrícula" },
        { name: "barcode", label: "Código de barras" },
        { name: "driver_id", label: "Motorista", type: "select", options: drivers },
        { name: "cash_register_id", label: "Caixa associado", type: "select", options: registers },
        { name: "notes", label: "Notas", type: "textarea", span: 2 },
        { name: "active", label: "Ativo", type: "boolean", default: true },
      ]}
    />
  );
}
