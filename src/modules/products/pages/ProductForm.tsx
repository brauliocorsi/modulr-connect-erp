import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { Chatter } from "@/core/chatter/Chatter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";

export default function ProductForm() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const nav = useNavigate();
  const [form, setForm] = useState<any>({
    name: "",
    internal_ref: "",
    type: "storable",
    list_price: 0,
    standard_cost: 0,
    can_be_sold: true,
    can_be_purchased: true,
    can_be_manufactured: false,
    description: "",
  });

  const { data: cats } = useQuery({
    queryKey: ["product_categories_list"],
    queryFn: async () => (await supabase.from("product_categories").select("id,name").order("name")).data ?? [],
  });
  const { data: uoms } = useQuery({
    queryKey: ["uoms_list"],
    queryFn: async () => (await supabase.from("product_uom").select("id,name,code").order("name")).data ?? [],
  });

  useEffect(() => {
    if (isNew) return;
    supabase.from("products").select("*").eq("id", id!).maybeSingle().then(({ data }) => data && setForm(data));
  }, [id, isNew]);

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        const { data, error } = await supabase.from("products").insert(form).select("id").single();
        if (error) throw error;
        return data.id as string;
      }
      const { error } = await supabase.from("products").update(form).eq("id", id!);
      if (error) throw error;
      return id!;
    },
    onSuccess: (newId) => {
      toast.success("Salvo");
      if (isNew) nav(`/products/${newId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = async () => {
    if (!confirm("Excluir este produto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id!);
    if (error) return toast.error(error.message);
    nav("/products");
  };

  return (
    <>
      <FormHeader
        title={form.name || "Novo produto"}
        breadcrumb={[{ label: "Produtos", to: "/products" }, { label: form.name || "Novo" }]}
        backTo="/products"
        state={form.active === false ? { label: "Arquivado", tone: "destructive" } : undefined}
        actions={
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            Salvar
          </Button>
        }
        onDelete={isNew ? undefined : remove}
      />
      <PageBody>
        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
            <Card className="p-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-2">
                  <Label>Nome do produto</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Referência interna</Label>
                  <Input value={form.internal_ref ?? ""} onChange={(e) => setForm({ ...form, internal_ref: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="storable">Estocável</SelectItem>
                      <SelectItem value="consumable">Consumível</SelectItem>
                      <SelectItem value="service">Serviço</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select value={form.category_id ?? ""} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {cats?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Unidade</Label>
                  <Select value={form.uom_id ?? ""} onValueChange={(v) => setForm({ ...form, uom_id: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {uoms?.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Card>

            <Tabs defaultValue="sales">
              <TabsList>
                <TabsTrigger value="sales">Vendas</TabsTrigger>
                <TabsTrigger value="purchase">Compras</TabsTrigger>
                <TabsTrigger value="inventory">Inventário</TabsTrigger>
              </TabsList>
              <TabsContent value="sales" className="pt-4">
                <Card className="p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch checked={form.can_be_sold} onCheckedChange={(v) => setForm({ ...form, can_be_sold: v })} />
                    <Label>Pode ser vendido</Label>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Preço de venda</Label>
                      <Input type="number" step="0.01" value={form.list_price} onChange={(e) => setForm({ ...form, list_price: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição comercial</Label>
                    <Textarea rows={3} value={form.sales_description ?? ""} onChange={(e) => setForm({ ...form, sales_description: e.target.value })} />
                  </div>
                </Card>
              </TabsContent>
              <TabsContent value="purchase" className="pt-4">
                <Card className="p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch checked={form.can_be_purchased} onCheckedChange={(v) => setForm({ ...form, can_be_purchased: v })} />
                    <Label>Pode ser comprado</Label>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Custo padrão</Label>
                      <Input type="number" step="0.01" value={form.standard_cost} onChange={(e) => setForm({ ...form, standard_cost: Number(e.target.value) })} />
                    </div>
                  </div>
                </Card>
              </TabsContent>
              <TabsContent value="inventory" className="pt-4">
                <Card className="p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch checked={form.can_be_manufactured} onCheckedChange={(v) => setForm({ ...form, can_be_manufactured: v })} />
                    <Label>Pode ser fabricado (requer módulo de Manufatura)</Label>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Peso (kg)</Label>
                      <Input type="number" step="0.001" value={form.weight ?? 0} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} />
                    </div>
                  <div className="space-y-2">
                      <Label>Volume (m³)</Label>
                      <Input type="number" step="0.001" value={form.volume ?? 0} onChange={(e) => setForm({ ...form, volume: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Rastreamento</Label>
                      <Select value={form.tracking ?? "none"} onValueChange={(v) => setForm({ ...form, tracking: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sem rastreamento</SelectItem>
                          <SelectItem value="lot">Por lote</SelectItem>
                          <SelectItem value="serial">Por número de série</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </Card>
              </TabsContent>
            </Tabs>

            {!isNew && <Chatter recordType="product" recordId={id!} />}
          </div>

          <aside className="space-y-4">
            <Card className="p-4 text-sm">
              <div className="o-section-title mb-2">Resumo</div>
              <div className="flex justify-between"><span className="text-muted-foreground">Preço</span><span>R$ {Number(form.list_price ?? 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Custo</span><span>R$ {Number(form.standard_cost ?? 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tipo</span><span>{form.type}</span></div>
            </Card>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
