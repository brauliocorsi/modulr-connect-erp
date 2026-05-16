import { fmtMoney } from "@/lib/format";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { RecordSidebar } from "@/core/activities/RecordSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { TagPicker } from "../components/TagPicker";
import { SuppliersTab } from "./tabs/SuppliersTab";
import { VariantsTab } from "./tabs/VariantsTab";
import { BomTab } from "./tabs/BomTab";
import { StockTab } from "./tabs/StockTab";
import { WooTab } from "./tabs/WooTab";
import { ReorderingTab } from "./tabs/ReorderingTab";
import { PackagesTab } from "./tabs/PackagesTab";
import { printColisLabels } from "@/modules/barcode/printBarcodes";
import { Printer } from "lucide-react";

export default function ProductForm() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const nav = useNavigate();
  const [form, setForm] = useState<any>({
    name: "", internal_ref: "", barcode: "", type: "storable",
    list_price: 0, standard_cost: 0,
    can_be_sold: true, can_be_purchased: true, can_be_manufactured: false,
    description: "", short_description: "",
    weight: 0, gross_weight: 0, net_weight: 0, volume: 0,
    height: 0, width: 0, depth: 0,
    published_woo: false, woo_status: "draft",
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
      // Normalizar strings vazias para NULL nos campos com índice único
      // (barcode/internal_ref) — caso contrário "" colide com outro produto sem código.
      const payload = {
        ...form,
        barcode: form.barcode?.trim() ? form.barcode.trim() : null,
        internal_ref: form.internal_ref?.trim() ? form.internal_ref.trim() : null,
      };
      if (isNew) {
        const { data, error } = await supabase.from("products").insert(payload).select("id").single();
        if (error) throw error;
        return data.id as string;
      }
      const { error } = await supabase.from("products").update(payload).eq("id", id!);
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
          <div className="flex gap-2">
            {!isNew && (
              <Button size="sm" variant="outline" onClick={async () => {
                const { data } = await supabase.from("product_packages").select("id").eq("product_id", id!).order("sequence");
                const ids = (data ?? []).map((p: any) => p.id);
                if (!ids.length) { toast.error("Sem colis definidos"); return; }
                await printColisLabels(ids);
              }}>
                <Printer className="h-4 w-4 mr-1" /> Etiquetas colis
              </Button>
            )}
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
          </div>
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
                  <Label>Referência interna (SKU)</Label>
                  <Input value={form.internal_ref ?? ""} onChange={(e) => setForm({ ...form, internal_ref: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Código de barras (EAN/UPC)</Label>
                  <Input value={form.barcode ?? ""} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
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
                    <SelectContent>{cats?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>UoM venda</Label>
                  <Select value={form.uom_id ?? ""} onValueChange={(v) => setForm({ ...form, uom_id: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{uoms?.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>UoM compra</Label>
                  <Select value={form.purchase_uom_id ?? ""} onValueChange={(v) => setForm({ ...form, purchase_uom_id: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{uoms?.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2 space-y-2">
                  <Label>Etiquetas</Label>
                  <TagPicker productId={isNew ? undefined : id} />
                </div>
              </div>
            </Card>

            <Tabs defaultValue="sales">
              <TabsList className="flex-wrap">
                <TabsTrigger value="sales">Vendas</TabsTrigger>
                <TabsTrigger value="purchase">Compras</TabsTrigger>
                <TabsTrigger value="inventory">Inventário</TabsTrigger>
                <TabsTrigger value="variants" disabled={isNew}>Variantes</TabsTrigger>
                <TabsTrigger value="bom" disabled={isNew}>BOM/Kit</TabsTrigger>
                <TabsTrigger value="stock" disabled={isNew}>Stock</TabsTrigger>
                <TabsTrigger value="reordering" disabled={isNew}>Reabastecimento</TabsTrigger>
                <TabsTrigger value="woo">WooCommerce</TabsTrigger>
                <TabsTrigger value="packages" disabled={isNew}>Colis</TabsTrigger>
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
                    <div className="space-y-2">
                      <Label>Valor de montagem (€)</Label>
                      <Input type="number" step="0.01" value={form.assembly_fee ?? 0} onChange={(e) => setForm({ ...form, assembly_fee: Number(e.target.value) })} />
                      <p className="text-xs text-muted-foreground">Cobrado por unidade quando o cliente pede montagem.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Adicional de entrega (€)</Label>
                      <Input type="number" step="0.01" value={form.delivery_surcharge ?? 0} onChange={(e) => setForm({ ...form, delivery_surcharge: Number(e.target.value) })} />
                      <p className="text-xs text-muted-foreground">Somado à entrega base por unidade (ex.: produto volumoso).</p>
                    <div className="space-y-2">
                      <Label>Tempo de montagem (min)</Label>
                      <Input type="number" step="1" min={0} value={form.assembly_minutes ?? 0} onChange={(e) => setForm({ ...form, assembly_minutes: Number(e.target.value) })} />
                      <p className="text-xs text-muted-foreground">Minutos por unidade. Usado para calcular a capacidade da rota.</p>
                    </div>
                  </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição comercial</Label>
                    <Textarea rows={3} value={form.sales_description ?? ""} onChange={(e) => setForm({ ...form, sales_description: e.target.value })} />
                  </div>
                </Card>
              </TabsContent>

              <TabsContent value="purchase" className="pt-4 space-y-4">
                <Card className="p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch checked={form.can_be_purchased} onCheckedChange={(v) => setForm({ ...form, can_be_purchased: v })} />
                    <Label>Pode ser comprado</Label>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={!!form.auto_purchase} onCheckedChange={(v) => setForm({ ...form, auto_purchase: v })} />
                    <Label>Compra automática quando faltar stock <span className="text-xs text-muted-foreground">(usa o fornecedor preferencial e envia e-mail)</span></Label>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Custo padrão</Label>
                      <Input type="number" step="0.01" value={form.standard_cost} onChange={(e) => setForm({ ...form, standard_cost: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição de compra</Label>
                    <Textarea rows={2} value={form.purchase_description ?? ""} onChange={(e) => setForm({ ...form, purchase_description: e.target.value })} />
                  </div>
                </Card>
                {!isNew && <Card className="p-6"><SuppliersTab productId={id!} /></Card>}
              </TabsContent>

              <TabsContent value="inventory" className="pt-4 space-y-4">
                <Card className="p-6 space-y-4">
                  <div className="o-section-title">Tipo & Capacidades</div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Tipo de produto</Label>
                      <Select value={form.product_kind ?? ""} onValueChange={(v) => setForm({ ...form, product_kind: v })}>
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="finished">Produto acabado</SelectItem>
                          <SelectItem value="raw">Matéria-prima</SelectItem>
                          <SelectItem value="component">Componente</SelectItem>
                          <SelectItem value="service">Serviço</SelectItem>
                          <SelectItem value="manufactured">Fabricado</SelectItem>
                          <SelectItem value="purchased">Comprado</SelectItem>
                          <SelectItem value="mixed">Misto (compra + fabrica)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch checked={form.can_be_manufactured} onCheckedChange={(v) => setForm({ ...form, can_be_manufactured: v })} />
                      <Label>Pode ser fabricado</Label>
                    </div>
                    {form.can_be_manufactured && (
                      <div className="flex items-center gap-3">
                        <Switch checked={!!form.requires_bom} onCheckedChange={(v) => setForm({ ...form, requires_bom: v })} />
                        <Label>Requer BOM</Label>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Lead time compra (dias)</Label>
                      <Input type="number" min={0} value={form.purchase_lead_time_days ?? 0} onChange={(e) => setForm({ ...form, purchase_lead_time_days: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Lead time fabrico (dias)</Label>
                      <Input type="number" min={0} value={form.mfg_lead_time_days ?? 0} onChange={(e) => setForm({ ...form, mfg_lead_time_days: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Stock mínimo</Label>
                      <Input type="number" step="0.01" value={form.min_stock ?? 0} onChange={(e) => setForm({ ...form, min_stock: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Stock máximo</Label>
                      <Input type="number" step="0.01" value={form.max_stock ?? 0} onChange={(e) => setForm({ ...form, max_stock: Number(e.target.value) })} />
                    </div>
                  </div>
                </Card>
                <Card className="p-6 space-y-4">
                  <div className="o-section-title">Físico</div>
                  <div className="grid sm:grid-cols-3 gap-4">
                    <div className="space-y-2"><Label>Peso (kg)</Label><Input type="number" step="0.001" value={form.weight ?? 0} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} /></div>
                    <div className="space-y-2"><Label>Peso bruto (kg)</Label><Input type="number" step="0.001" value={form.gross_weight ?? 0} onChange={(e) => setForm({ ...form, gross_weight: Number(e.target.value) })} /></div>
                    <div className="space-y-2"><Label>Peso líquido (kg)</Label><Input type="number" step="0.001" value={form.net_weight ?? 0} onChange={(e) => setForm({ ...form, net_weight: Number(e.target.value) })} /></div>
                    <div className="space-y-2"><Label>Volume (m³)</Label><Input type="number" step="0.001" value={form.volume ?? 0} onChange={(e) => setForm({ ...form, volume: Number(e.target.value) })} /></div>
                    <div className="space-y-2"><Label>Altura (cm)</Label><Input type="number" step="0.1" value={form.height ?? 0} onChange={(e) => setForm({ ...form, height: Number(e.target.value) })} /></div>
                    <div className="space-y-2"><Label>Largura (cm)</Label><Input type="number" step="0.1" value={form.width ?? 0} onChange={(e) => setForm({ ...form, width: Number(e.target.value) })} /></div>
                    <div className="space-y-2"><Label>Profundidade (cm)</Label><Input type="number" step="0.1" value={form.depth ?? 0} onChange={(e) => setForm({ ...form, depth: Number(e.target.value) })} /></div>
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

              {!isNew && <TabsContent value="variants" className="pt-4"><Card className="p-6"><VariantsTab productId={id!} /></Card></TabsContent>}
              {!isNew && <TabsContent value="bom" className="pt-4"><Card className="p-6"><BomTab productId={id!} /></Card></TabsContent>}
              {!isNew && <TabsContent value="stock" className="pt-4"><Card className="p-6"><StockTab productId={id!} /></Card></TabsContent>}
              {!isNew && <TabsContent value="reordering" className="pt-4"><Card className="p-6"><ReorderingTab productId={id!} /></Card></TabsContent>}
              <TabsContent value="woo" className="pt-4"><Card className="p-6"><WooTab form={form} setForm={setForm} /></Card></TabsContent>
              {!isNew && <TabsContent value="packages" className="pt-4 space-y-4"><Card className="p-6"><PackageTrackingToggle productId={id!} /></Card><Card className="p-6"><PackagesTab productId={id!} /></Card></TabsContent>}
            </Tabs>

            {!isNew && <RecordSidebar recordType="product" recordId={id!} />}
          </div>

          <aside className="space-y-4">
            <Card className="p-4 text-sm">
              <div className="o-section-title mb-2">Resumo</div>
              <div className="flex justify-between"><span className="text-muted-foreground">Preço</span><span>{fmtMoney(form.list_price)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Custo</span><span>{fmtMoney(form.standard_cost)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tipo</span><span>{form.type}</span></div>
              {form.barcode && <div className="flex justify-between"><span className="text-muted-foreground">Barcode</span><span>{form.barcode}</span></div>}
            </Card>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
