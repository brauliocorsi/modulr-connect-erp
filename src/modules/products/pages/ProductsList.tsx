import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtMoney } from "@/lib/format";
import { PageHeader, PageBody, EmptyState } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";

type TriBool = "any" | "yes" | "no";

export default function ProductsList() {
  const [search, setSearch] = useState("");
  const [variantSku, setVariantSku] = useState("");
  const [supplierId, setSupplierId] = useState<string>("any");
  const [type, setType] = useState<string>("any");
  const [categoryId, setCategoryId] = useState<string>("any");
  const [sellable, setSellable] = useState<TriBool>("any");
  const [purchasable, setPurchasable] = useState<TriBool>("any");
  const [manufactured, setManufactured] = useState<TriBool>("any");

  const { data: suppliers } = useQuery({
    queryKey: ["pl-suppliers"],
    queryFn: async () => (await supabase.from("partners").select("id,name").eq("is_supplier", true).order("name")).data ?? [],
  });
  const { data: cats } = useQuery({
    queryKey: ["pl-cats"],
    queryFn: async () => (await supabase.from("product_categories").select("id,name").order("name")).data ?? [],
  });

  // Resolve supplier and variant filters into product id sets
  const [supplierProductIds, setSupplierProductIds] = useState<string[] | null>(null);
  const [variantProductIds, setVariantProductIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (supplierId === "any") { setSupplierProductIds(null); return; }
    supabase.from("product_suppliers").select("product_id").eq("partner_id", supplierId)
      .then(({ data }) => setSupplierProductIds(Array.from(new Set((data ?? []).map((r: any) => r.product_id)))));
  }, [supplierId]);

  useEffect(() => {
    const term = variantSku.trim();
    if (!term) { setVariantProductIds(null); return; }
    const t = setTimeout(() => {
      supabase.from("product_variants").select("product_id").ilike("sku", `%${term}%`).limit(500)
        .then(({ data }) => setVariantProductIds(Array.from(new Set((data ?? []).map((r: any) => r.product_id)))));
    }, 250);
    return () => clearTimeout(t);
  }, [variantSku]);

  const { data: products, isLoading } = useQuery({
    queryKey: ["products-adv", search, type, categoryId, sellable, purchasable, manufactured, supplierProductIds, variantProductIds],
    queryFn: async () => {
      let q: any = supabase.from("products").select("id,name,internal_ref,barcode,type,list_price,standard_cost,can_be_sold,can_be_purchased,can_be_manufactured,category_id").order("name");
      const s = search.trim();
      if (s) q = q.or(`name.ilike.%${s}%,internal_ref.ilike.%${s}%,barcode.ilike.%${s}%`);
      if (type !== "any") q = q.eq("type", type);
      if (categoryId !== "any") q = q.eq("category_id", categoryId);
      if (sellable !== "any") q = q.eq("can_be_sold", sellable === "yes");
      if (purchasable !== "any") q = q.eq("can_be_purchased", purchasable === "yes");
      if (manufactured !== "any") q = q.eq("can_be_manufactured", manufactured === "yes");
      if (supplierProductIds) q = q.in("id", supplierProductIds.length ? supplierProductIds : ["00000000-0000-0000-0000-000000000000"]);
      if (variantProductIds) q = q.in("id", variantProductIds.length ? variantProductIds : ["00000000-0000-0000-0000-000000000000"]);
      const { data, error } = await q.limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const activeFilters = useMemo(() => {
    const out: { key: string; label: string; clear: () => void }[] = [];
    if (type !== "any") out.push({ key: "type", label: `Tipo: ${type}`, clear: () => setType("any") });
    if (categoryId !== "any") out.push({ key: "cat", label: `Categoria: ${cats?.find((c: any) => c.id === categoryId)?.name ?? ""}`, clear: () => setCategoryId("any") });
    if (sellable !== "any") out.push({ key: "sell", label: `Vendável: ${sellable === "yes" ? "sim" : "não"}`, clear: () => setSellable("any") });
    if (purchasable !== "any") out.push({ key: "purch", label: `Comprável: ${purchasable === "yes" ? "sim" : "não"}`, clear: () => setPurchasable("any") });
    if (manufactured !== "any") out.push({ key: "manuf", label: `Fabricado: ${manufactured === "yes" ? "sim" : "não"}`, clear: () => setManufactured("any") });
    if (supplierId !== "any") out.push({ key: "sup", label: `Fornecedor: ${suppliers?.find((s: any) => s.id === supplierId)?.name ?? ""}`, clear: () => setSupplierId("any") });
    if (variantSku.trim()) out.push({ key: "var", label: `Variante SKU: ${variantSku}`, clear: () => setVariantSku("") });
    return out;
  }, [type, categoryId, sellable, purchasable, manufactured, supplierId, variantSku, cats, suppliers]);

  const clearAll = () => {
    setType("any"); setCategoryId("any"); setSellable("any"); setPurchasable("any");
    setManufactured("any"); setSupplierId("any"); setVariantSku(""); setSearch("");
  };

  return (
    <>
      <PageHeader title="Produtos" breadcrumb={[{ label: "Produtos" }]} createTo="/products/new" />
      <PageBody>
        <Card className="p-3 mb-3 space-y-3">
          <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-2">
            <div className="relative md:col-span-2">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="h-9 pl-8" placeholder="Buscar por nome, referência ou código de barras…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Input className="h-9" placeholder="SKU da variante…" value={variantSku} onChange={(e) => setVariantSku(e.target.value)} />
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Qualquer fornecedor</SelectItem>
                {suppliers?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Qualquer tipo</SelectItem>
                <SelectItem value="storable">Estocável</SelectItem>
                <SelectItem value="consumable">Consumível</SelectItem>
                <SelectItem value="service">Serviço</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Qualquer categoria</SelectItem>
                {cats?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sellable} onValueChange={(v) => setSellable(v as TriBool)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Vendável" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Vendável: todos</SelectItem>
                <SelectItem value="yes">Apenas vendáveis</SelectItem>
                <SelectItem value="no">Não vendáveis</SelectItem>
              </SelectContent>
            </Select>
            <Select value={purchasable} onValueChange={(v) => setPurchasable(v as TriBool)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Comprável" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Comprável: todos</SelectItem>
                <SelectItem value="yes">Apenas compráveis</SelectItem>
                <SelectItem value="no">Não compráveis</SelectItem>
              </SelectContent>
            </Select>
            <Select value={manufactured} onValueChange={(v) => setManufactured(v as TriBool)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Fabricado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Fabricado: todos</SelectItem>
                <SelectItem value="yes">Apenas fabricados</SelectItem>
                <SelectItem value="no">Não fabricados</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center">
              {activeFilters.map((f) => (
                <span key={f.key} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded">
                  {f.label}
                  <button onClick={f.clear} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                </span>
              ))}
              <Button size="sm" variant="ghost" onClick={clearAll}>Limpar tudo</Button>
            </div>
          )}
        </Card>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : !products || products.length === 0 ? (
          <EmptyState title="Nenhum registro" description="Ajuste os filtros ou crie um novo produto." />
        ) : (
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Ref</th>
                  <th className="text-left font-medium px-3 py-2">Nome</th>
                  <th className="text-left font-medium px-3 py-2">Tipo</th>
                  <th className="text-left font-medium px-3 py-2">Marcações</th>
                  <th className="text-left font-medium px-3 py-2">Preço</th>
                  <th className="text-left font-medium px-3 py-2">Custo</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p: any) => (
                  <tr key={p.id} className="o-list-row">
                    <td colSpan={6} className="p-0">
                      <Link to={`/products/${p.id}`} className="grid" style={{ gridTemplateColumns: "repeat(6, minmax(0,1fr))" }}>
                        <span className="px-3 py-2">{p.internal_ref ?? "—"}</span>
                        <span className="px-3 py-2">{p.name}</span>
                        <span className="px-3 py-2">{p.type}</span>
                        <span className="px-3 py-2 flex flex-wrap gap-1">
                          {p.can_be_sold && <Badge variant="secondary" className="text-[10px]">Vendável</Badge>}
                          {p.can_be_purchased && <Badge variant="secondary" className="text-[10px]">Comprável</Badge>}
                          {p.can_be_manufactured && <Badge variant="secondary" className="text-[10px]">Fabricado</Badge>}
                        </span>
                        <span className="px-3 py-2">{fmtMoney(p.list_price)}</span>
                        <span className="px-3 py-2">{fmtMoney(p.standard_cost)}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </>
  );
}
