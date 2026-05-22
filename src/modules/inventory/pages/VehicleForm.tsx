import { useEffect, useState } from "react";
import { SimpleForm } from "@/core/layout/SimpleForm";
import { supabase } from "@/integrations/supabase/client";

export default function VehicleForm() {
  const [drivers, setDrivers] = useState<{ value: string; label: string }[]>([]);
  const [registers, setRegisters] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    (async () => {
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
        // Identificação
        { name: "name", label: "Nome (ex: VAN-01)", required: true },
        { name: "license_plate", label: "Matrícula" },
        { name: "barcode", label: "Código de barras" },
        { name: "driver_id", label: "Motorista", type: "select", options: drivers },
        { name: "cash_register_id", label: "Caixa associado", type: "select", options: registers },
        { name: "active", label: "Ativo", type: "boolean", default: true },

        // Capacidade de carga (usada pelo Cronograma de Rotas)
        { name: "usable_volume_m3", label: "Volume útil (m³) — usado no cronograma", type: "number", placeholder: "ex: 12.5" },
        { name: "volume_m3", label: "Volume total (m³)", type: "number" },
        { name: "max_weight_kg", label: "Carga máxima (kg)", type: "number" },
        { name: "weight_kg", label: "Tara — peso vazio (kg)", type: "number" },

        // Dimensões úteis do compartimento
        { name: "usable_length_cm", label: "Comprimento útil (cm)", type: "number" },
        { name: "usable_width_cm", label: "Largura útil (cm)", type: "number" },
        { name: "usable_height_cm", label: "Altura útil (cm)", type: "number" },
        { name: "supports_flat_transport", label: "Suporta transporte em plano", type: "boolean" },

        // Capacidade operacional
        { name: "max_stops", label: "Nº máximo de paragens", type: "number" },
        { name: "assembly_minutes_capacity", label: "Minutos de montagem por turno", type: "number" },
        { name: "max_assembly_minutes", label: "Limite duro de montagem (min)", type: "number" },
        { name: "requires_load_verification", label: "Exige verificação de carga", type: "boolean" },

        { name: "notes", label: "Notas", type: "textarea", span: 2 },
      ]}
    />
  );
}
