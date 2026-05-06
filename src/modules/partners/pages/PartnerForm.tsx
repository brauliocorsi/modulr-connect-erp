import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { RecordSidebar } from "@/core/activities/RecordSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export default function PartnerForm({ defaultKind }: { defaultKind: "customer" | "supplier" }) {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const backTo = sp.get("back") ?? (defaultKind === "customer" ? "/sales/customers" : "/purchase/suppliers");

  const [form, setForm] = useState<any>({
    name: "",
    kind: "company",
    is_customer: defaultKind === "customer",
    is_supplier: defaultKind === "supplier",
  });

  useEffect(() => {
    if (isNew) return;
    supabase.from("partners").select("*").eq("id", id!).maybeSingle().then(({ data }) => data && setForm(data));
  }, [id, isNew]);

  const save = async () => {
    if (isNew) {
      const { data, error } = await supabase.from("partners").insert(form).select("id").single();
      if (error) return toast.error(error.message);
      toast.success("Salvo");
      nav(`${backTo}/${data.id}`);
    } else {
      const { error } = await supabase.from("partners").update(form).eq("id", id!);
      if (error) return toast.error(error.message);
      toast.success("Salvo");
    }
  };

  const remove = async () => {
    if (!confirm("Excluir?")) return;
    const { error } = await supabase.from("partners").delete().eq("id", id!);
    if (error) return toast.error(error.message);
    nav(backTo);
  };

  return (
    <>
      <FormHeader
        title={form.name || (defaultKind === "customer" ? "Novo cliente" : "Novo fornecedor")}
        breadcrumb={[
          { label: defaultKind === "customer" ? "Vendas" : "Compras", to: defaultKind === "customer" ? "/sales" : "/purchase" },
          { label: defaultKind === "customer" ? "Clientes" : "Fornecedores", to: backTo },
          { label: form.name || "Novo" },
        ]}
        backTo={backTo}
        actions={<Button size="sm" onClick={save}>Salvar</Button>}
        onDelete={isNew ? undefined : remove}
      />
      <PageBody>
        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
            <Card className="p-6 grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-2">
                <Label>Nome</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>CNPJ/CPF</Label>
                <Input value={form.tax_id ?? ""} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Cidade</Label>
                <Input value={form.city ?? ""} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="sm:col-span-2 space-y-2">
                <Label>Endereço</Label>
                <Input value={form.street ?? ""} onChange={(e) => setForm({ ...form, street: e.target.value })} />
              </div>
              <div className="sm:col-span-2 space-y-2">
                <Label>Notas</Label>
                <Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </Card>
            <Card className="p-6 flex flex-wrap gap-6">
              <label className="flex items-center gap-2">
                <Switch checked={form.is_customer} onCheckedChange={(v) => setForm({ ...form, is_customer: v })} />
                Cliente
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={form.is_supplier} onCheckedChange={(v) => setForm({ ...form, is_supplier: v })} />
                Fornecedor
              </label>
            </Card>
            {!isNew && <RecordSidebar recordType="partner" recordId={id!} />}
          </div>
          <aside />
        </div>
      </PageBody>
    </>
  );
}
