import { useEffect, useState } from "react";
import { ListView } from "@/core/layout/ListView";
import { SimpleForm } from "@/core/layout/SimpleForm";
import { PageHeader, PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { fmtDateTime } from "@/lib/format";
import { Play, Square, Clock } from "lucide-react";
import { toast } from "sonner";

export const EmployeesList = () => (
  <ListView
    title="Colaboradores"
    breadcrumb={[{ label: "RH", to: "/hr" }, { label: "Colaboradores" }]}
    table="hr_employees"
    searchColumn="full_name"
    createTo="/hr/employees/new"
    rowLink={(r: any) => `/hr/employees/${r.id}`}
    columns={[
      { key: "full_name", header: "Nome" },
      { key: "job_title", header: "Cargo" },
      { key: "email", header: "E-mail" },
      { key: "phone", header: "Telefone" },
    ]}
  />
);

export const EmployeeForm = () => (
  <SimpleForm
    table="hr_employees"
    title="Colaborador"
    basePath="/hr/employees"
    breadcrumb={[{ label: "RH", to: "/hr" }, { label: "Colaboradores", to: "/hr/employees" }, { label: "Editar" }]}
    fields={[
      { name: "full_name", label: "Nome", required: true },
      { name: "email", label: "E-mail" },
      { name: "phone", label: "Telefone" },
      { name: "job_title", label: "Cargo" },
      { name: "department_id", label: "Departamento", type: "select", optionsFrom: { table: "hr_departments", value: "id", label: "name" } },
      { name: "manager_id", label: "Gestor", type: "select", optionsFrom: { table: "hr_employees", value: "id", label: "full_name" } },
      { name: "hire_date", label: "Admissão", type: "date" },
      { name: "birth_date", label: "Nascimento", type: "date" },
      { name: "active", label: "Ativo", type: "boolean", default: true },
    ]}
  />
);

export const DepartmentsList = () => (
  <ListView
    title="Departamentos"
    breadcrumb={[{ label: "RH", to: "/hr" }, { label: "Departamentos" }]}
    table="hr_departments"
    searchColumn="name"
    createTo="/hr/departments/new"
    rowLink={(r: any) => `/hr/departments/${r.id}`}
    columns={[{ key: "name", header: "Nome" }]}
  />
);

export const DepartmentForm = () => (
  <SimpleForm
    table="hr_departments"
    title="Departamento"
    basePath="/hr/departments"
    breadcrumb={[{ label: "RH", to: "/hr" }, { label: "Departamentos", to: "/hr/departments" }, { label: "Editar" }]}
    fields={[
      { name: "name", label: "Nome", required: true },
      { name: "manager_id", label: "Gestor", type: "select", optionsFrom: { table: "hr_employees", value: "id", label: "full_name" } },
    ]}
  />
);

export const LeavesList = () => (
  <ListView
    title="Pedidos de Ausência"
    breadcrumb={[{ label: "RH", to: "/hr" }, { label: "Ausências" }]}
    table="hr_leaves"
    select="id, type, start_date, end_date, state, hr_employees(full_name)"
    searchColumn="reason"
    createTo="/hr/leaves/new"
    rowLink={(r: any) => `/hr/leaves/${r.id}`}
    columns={[
      { key: "employee", header: "Colaborador", render: (r: any) => r.hr_employees?.full_name },
      { key: "type", header: "Tipo" },
      { key: "start_date", header: "Início" },
      { key: "end_date", header: "Fim" },
      { key: "state", header: "Estado", render: (r: any) => <span className="o-state-badge">{r.state}</span> },
    ]}
  />
);

export const LeaveForm = () => (
  <SimpleForm
    table="hr_leaves"
    title="Ausência"
    basePath="/hr/leaves"
    breadcrumb={[{ label: "RH", to: "/hr" }, { label: "Ausências", to: "/hr/leaves" }, { label: "Editar" }]}
    fields={[
      { name: "employee_id", label: "Colaborador", required: true, type: "select", optionsFrom: { table: "hr_employees", value: "id", label: "full_name" } },
      { name: "type", label: "Tipo", type: "select", default: "vacation", options: [
        { value: "vacation", label: "Férias" }, { value: "sick", label: "Doença" }, { value: "personal", label: "Pessoal" }] },
      { name: "start_date", label: "Início", type: "date", required: true },
      { name: "end_date", label: "Fim", type: "date", required: true },
      { name: "reason", label: "Motivo", type: "textarea" },
      { name: "state", label: "Estado", type: "select", default: "draft", options: [
        { value: "draft", label: "Rascunho" }, { value: "requested", label: "Solicitado" },
        { value: "approved", label: "Aprovado" }, { value: "refused", label: "Recusado" }] },
    ]}
  />
);

// ===== ATTENDANCE / Relógio de ponto =====
export function AttendanceClock() {
  const { user } = useAuth();
  const [emp, setEmp] = useState<any>(null);
  const [open, setOpen] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

  const load = async () => {
    if (!user) return;
    const { data: e } = await supabase.from("hr_employees").select("*").eq("user_id", user.id).maybeSingle();
    setEmp(e);
    if (!e) return;
    const { data: o } = await supabase.from("hr_attendances").select("*").eq("employee_id", e.id).is("check_out", null).maybeSingle();
    setOpen(o);
    const { data: h } = await supabase.from("hr_attendances").select("*").eq("employee_id", e.id).order("check_in", { ascending: false }).limit(20);
    setHistory(h ?? []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const checkIn = async () => {
    if (!emp) return toast.error("Sem ficha de colaborador associada ao seu utilizador.");
    const { error } = await supabase.from("hr_attendances").insert({ employee_id: emp.id });
    if (error) return toast.error(error.message);
    toast.success("Entrada registada"); load();
  };

  const checkOut = async () => {
    if (!open) return;
    const now = new Date();
    const hours = (now.getTime() - new Date(open.check_in).getTime()) / 36e5;
    const { error } = await supabase.from("hr_attendances")
      .update({ check_out: now.toISOString(), worked_hours: Number(hours.toFixed(2)) }).eq("id", open.id);
    if (error) return toast.error(error.message);
    toast.success("Saída registada"); load();
  };

  return (
    <>
      <PageHeader title="Relógio de Ponto" breadcrumb={[{ label: "RH", to: "/hr" }, { label: "Assiduidade" }]} />
      <PageBody>
        {!emp ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Nenhum colaborador associado ao seu utilizador. Peça a um administrador para criar a sua ficha em RH → Colaboradores.
          </Card>
        ) : (
          <Card className="p-6 flex items-center gap-6">
            <div className="h-16 w-16 rounded-full bg-primary/15 grid place-items-center"><Clock className="h-8 w-8" /></div>
            <div className="flex-1">
              <div className="font-semibold">{emp.full_name}</div>
              <div className="text-sm text-muted-foreground">
                {open ? `Em serviço desde ${fmtDateTime(open.check_in)}` : "Fora de serviço"}
              </div>
            </div>
            {open ? (
              <Button onClick={checkOut} variant="destructive"><Square className="h-4 w-4 mr-2" /> Saída</Button>
            ) : (
              <Button onClick={checkIn}><Play className="h-4 w-4 mr-2" /> Entrada</Button>
            )}
          </Card>
        )}

        <Card className="mt-4">
          <div className="px-4 py-3 border-b font-semibold">Histórico recente</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr><th className="text-left p-2">Entrada</th><th className="text-left p-2">Saída</th><th className="text-left p-2">Horas</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t">
                  <td className="p-2">{fmtDateTime(h.check_in)}</td>
                  <td className="p-2">{h.check_out ? fmtDateTime(h.check_out) : "—"}</td>
                  <td className="p-2">{h.worked_hours ?? "—"}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">Sem registos.</td></tr>}
            </tbody>
          </table>
        </Card>
      </PageBody>
    </>
  );
}

export const AttendancesList = () => (
  <ListView
    title="Assiduidade (todos)"
    breadcrumb={[{ label: "RH", to: "/hr" }, { label: "Assiduidade" }]}
    table="hr_attendances"
    select="id, check_in, check_out, worked_hours, hr_employees(full_name)"
    searchColumn="notes"
    columns={[
      { key: "employee", header: "Colaborador", render: (r: any) => r.hr_employees?.full_name },
      { key: "check_in", header: "Entrada", render: (r: any) => fmtDateTime(r.check_in) },
      { key: "check_out", header: "Saída", render: (r: any) => r.check_out ? fmtDateTime(r.check_out) : "—" },
      { key: "worked_hours", header: "Horas" },
    ]}
  />
);
