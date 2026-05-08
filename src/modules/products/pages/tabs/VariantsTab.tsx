import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Sparkles, Upload, X, Image as ImageIcon, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Variant = {
  id: string;
  sku: string | null;
  barcode: string | null;
  price_extra: number;
  active: boolean;
  weight: number | null;
  image_url: string | null;
  product_variant_values: { value_id: string; product_attribute_values: { name: string } | null }[];
};

const slug = (s: string) => (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "").toUpperCase();

export function VariantsTab({ productId }: { productId: string }) {
  const [productCode, setProductCode] = useState<string>("");
  const [attrs, setAttrs] = useState<any[]>([]);
  const [allAttrs, setAllAttrs] = useState<any[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({}); // attribute_id -> value_id | "all"
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPrice, setBulkPrice] = useState<string>("");
  const [bulkWeight, setBulkWeight] = useState<string>("");
  const [skuPrefix, setSkuPrefix] = useState<string>("");
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, { sku?: string; barcode?: string }>>({});
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);

  const setRowError = (id: string, field: "sku" | "barcode", msg?: string) =>
    setRowErrors((p) => {
      const next = { ...p, [id]: { ...p[id], [field]: msg } };
      if (!next[id].sku && !next[id].barcode) delete next[id];
      return next;
    });

  const isUniqueError = (err: any) => err?.code === "23505" || /duplicate key|unique/i.test(err?.message ?? "");

  const load = async () => {
    const { data: prod } = await supabase.from("products").select("name").eq("id", productId).maybeSingle();
    setProductCode(slug((prod as any)?.name || "").slice(0, 8));

    const { data: tas } = await supabase
      .from("product_template_attributes")
      .select("id, attribute_id, product_attributes(name)")
      .eq("product_id", productId);
    const ids = (tas ?? []).map((t: any) => t.id);
    let vals: any[] = [];
    if (ids.length) {
      const { data } = await supabase
        .from("product_template_attribute_values")
        .select("id, template_attribute_id, value_id, price_extra, product_attribute_values(name, color)")
        .in("template_attribute_id", ids);
      vals = data ?? [];
    }
    setAttrs((tas ?? []).map((t: any) => ({ ...t, values: vals.filter((v: any) => v.template_attribute_id === t.id) })));

    const { data: aa } = await supabase
      .from("product_attributes")
      .select("id,name,product_attribute_values(id,name,color)")
      .order("name");
    setAllAttrs(aa ?? []);

    const { data: vs } = await supabase
      .from("product_variants")
      .select("id, sku, barcode, price_extra, active, weight, image_url, product_variant_values(value_id, product_attribute_values(name))")
      .eq("product_id", productId);
    setVariants((vs as any) ?? []);
  };

  useEffect(() => { load(); }, [productId]);

  // map attribute_id -> set of value_ids that belong to it (from allAttrs)
  const valueToAttribute = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of allAttrs) {
      for (const v of a.product_attribute_values || []) m[v.id] = a.id;
    }
    return m;
  }, [allAttrs]);

  const filteredVariants = useMemo(() => {
    return variants.filter((v) => {
      for (const [attrId, valId] of Object.entries(filters)) {
        if (!valId || valId === "all") continue;
        const has = v.product_variant_values.some((pvv) => pvv.value_id === valId);
        if (!has) return false;
      }
      return true;
    }).sort((a, b) => {
      const la = (a.product_variant_values || []).map((x) => x.product_attribute_values?.name || "").join("/");
      const lb = (b.product_variant_values || []).map((x) => x.product_attribute_values?.name || "").join("/");
      return la.localeCompare(lb);
    });
  }, [variants, filters]);

  const allFilteredSelected = filteredVariants.length > 0 && filteredVariants.every((v) => selected.has(v.id));
  const toggleAllFiltered = () => {
    const next = new Set(selected);
    if (allFilteredSelected) filteredVariants.forEach((v) => next.delete(v.id));
    else filteredVariants.forEach((v) => next.add(v.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  // attribute admin
  const addAttr = async (attribute_id: string) => {
    if (attrs.find((a) => a.attribute_id === attribute_id)) return;
    await supabase.from("product_template_attributes").insert({ product_id: productId, attribute_id });
    load();
  };
  const toggleValue = async (templateAttrId: string, value_id: string, on: boolean) => {
    if (on) await supabase.from("product_template_attribute_values").insert({ template_attribute_id: templateAttrId, value_id });
    else await supabase.from("product_template_attribute_values").delete().eq("template_attribute_id", templateAttrId).eq("value_id", value_id);
    load();
  };
  const removeAttr = async (id: string) => {
    await supabase.from("product_template_attributes").delete().eq("id", id);
    load();
  };
  const generate = async () => {
    const { data, error } = await supabase.rpc("generate_product_variants", { _product: productId });
    if (error) return toast.error(error.message);
    toast.success(`${data ?? 0} variantes geradas`);
    load();
  };

  const updateVariant = async (v: Variant, patch: any) => {
    const checkField = (field: "sku" | "barcode") => {
      if (!(field in patch)) return null;
      const val = (patch[field] ?? "").toString().trim();
      if (!val) return null;
      const dup = variants.find((x) => x.id !== v.id && ((x as any)[field] ?? "").toString().trim() === val);
      if (dup) {
        const label = (dup.product_variant_values || []).map((x: any) => x.product_attribute_values?.name).join(" / ") || dup.id.slice(0, 6);
        return `Já usado por: ${label}`;
      }
      return null;
    };
    const skuErr = checkField("sku");
    const bcErr = checkField("barcode");
    if (skuErr) { setRowError(v.id, "sku", skuErr); toast.error(`SKU duplicado — ${skuErr}`); return; }
    if (bcErr) { setRowError(v.id, "barcode", bcErr); toast.error(`Código de barras duplicado — ${bcErr}`); return; }

    const { error } = await supabase.from("product_variants").update(patch).eq("id", v.id);
    if (error) {
      if (isUniqueError(error)) {
        const field = /barcode/i.test(error.message) ? "barcode" : "sku";
        setRowError(v.id, field, "Valor duplicado no banco");
        return toast.error(`${field === "sku" ? "SKU" : "Código de barras"} já existe em outra variante`);
      }
      return toast.error(error.message);
    }
    if ("sku" in patch) setRowError(v.id, "sku", undefined);
    if ("barcode" in patch) setRowError(v.id, "barcode", undefined);
    load();
  };
  const removeVariant = async (id: string) => {
    if (!confirm("Remover variante?")) return;
    await supabase.from("product_variants").delete().eq("id", id);
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    load();
  };

  // ===== Bulk actions =====
  const selectedIds = () => Array.from(selected).filter((id) => filteredVariants.some((v) => v.id === id));
  const requireSelection = () => {
    const ids = selectedIds();
    if (!ids.length) { toast.error("Selecione variantes primeiro"); return null; }
    return ids;
  };

  const applyBulkPrice = async (mode: "set" | "add") => {
    const ids = requireSelection(); if (!ids) return;
    const value = Number(bulkPrice);
    if (Number.isNaN(value)) return toast.error("Valor inválido");
    if (mode === "set") {
      await supabase.from("product_variants").update({ price_extra: value }).in("id", ids);
    } else {
      await Promise.all(ids.map((id) => {
        const v = variants.find((x) => x.id === id);
        return supabase.from("product_variants").update({ price_extra: Number(v?.price_extra ?? 0) + value }).eq("id", id);
      }));
    }
    toast.success(`${ids.length} variantes atualizadas`);
    setBulkPrice(""); load();
  };
  const applyBulkWeight = async () => {
    const ids = requireSelection(); if (!ids) return;
    const value = Number(bulkWeight);
    if (Number.isNaN(value)) return toast.error("Valor inválido");
    await supabase.from("product_variants").update({ weight: value }).in("id", ids);
    toast.success(`${ids.length} variantes atualizadas`);
    setBulkWeight(""); load();
  };
  const applyBulkActive = async (active: boolean) => {
    const ids = requireSelection(); if (!ids) return;
    await supabase.from("product_variants").update({ active }).in("id", ids);
    toast.success(`${ids.length} variantes ${active ? "ativadas" : "desativadas"}`);
    load();
  };
  const applyBulkSku = async () => {
    const ids = requireSelection(); if (!ids) return;
    const prefix = skuPrefix || productCode || "VAR";
    setBulkErrors([]);

    // 1. Compute target SKUs
    const targets = ids.map((id) => {
      const v = variants.find((x) => x.id === id)!;
      const parts = (v.product_variant_values || []).map((x) => slug(x.product_attribute_values?.name || ""));
      const sku = [prefix, ...parts].filter(Boolean).join("-");
      const label = (v.product_variant_values || []).map((x: any) => x.product_attribute_values?.name).join(" / ") || id.slice(0, 6);
      return { id, sku, label };
    });

    const errs: string[] = [];
    const newRowErrs: Record<string, { sku?: string; barcode?: string }> = { ...rowErrors };

    // 2. Detect duplicates within the batch itself
    const counts = new Map<string, string[]>();
    targets.forEach((t) => {
      if (!t.sku) return;
      counts.set(t.sku, [...(counts.get(t.sku) || []), t.label]);
    });
    counts.forEach((labels, sku) => {
      if (labels.length > 1) errs.push(`SKU "${sku}" geraria duplicata para: ${labels.join(", ")}`);
    });

    // 3. Detect conflicts with variants outside the selection
    const idSet = new Set(ids);
    targets.forEach((t) => {
      if (!t.sku) return;
      const conflict = variants.find((x) => !idSet.has(x.id) && (x.sku ?? "").trim() === t.sku);
      if (conflict) {
        const cl = (conflict.product_variant_values || []).map((x: any) => x.product_attribute_values?.name).join(" / ");
        errs.push(`SKU "${t.sku}" (${t.label}) já existe em: ${cl}`);
        newRowErrs[t.id] = { ...newRowErrs[t.id], sku: `Conflita com ${cl}` };
      }
    });

    if (errs.length) {
      setBulkErrors(errs);
      setRowErrors(newRowErrs);
      toast.error(`${errs.length} conflito(s) de SKU — nada foi salvo`);
      return;
    }

    // 4. Apply
    const results = await Promise.all(targets.map((t) =>
      supabase.from("product_variants").update({ sku: t.sku }).eq("id", t.id).then((r) => ({ t, r }))
    ));
    const failed = results.filter((x) => x.r.error);
    if (failed.length) {
      const msgs = failed.map(({ t, r }) => `${t.label}: ${r.error?.message}`);
      setBulkErrors(msgs);
      toast.error(`${failed.length} erro(s) ao salvar`);
    } else {
      toast.success(`${ids.length} SKUs gerados`);
    }
    load();
  };

  // ===== Image upload =====
  const uploadImage = async (variant: Variant, file: File) => {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${productId}/${variant.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("product-variants").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("product-variants").getPublicUrl(path);
    await supabase.from("product_variants").update({ image_url: data.publicUrl }).eq("id", variant.id);
    toast.success("Foto enviada");
    load();
  };
  const removeImage = async (variant: Variant) => {
    await supabase.from("product_variants").update({ image_url: null }).eq("id", variant.id);
    load();
  };

  return (
    <div className="space-y-4">
      {/* Attributes config */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Atributos</div>
          <Select value="" onValueChange={addAttr}>
            <SelectTrigger className="w-56 h-8"><SelectValue placeholder="Adicionar atributo…" /></SelectTrigger>
            <SelectContent>{allAttrs.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          {attrs.length === 0 && <div className="text-sm text-muted-foreground">Nenhum atributo configurado</div>}
          {attrs.map((a) => {
            const fullAttr = allAttrs.find((x) => x.id === a.attribute_id);
            const selectedValueIds = new Set(a.values.map((v: any) => v.value_id));
            return (
              <div key={a.id} className="border rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">{a.product_attributes?.name}</div>
                  <Button size="icon" variant="ghost" onClick={() => removeAttr(a.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {fullAttr?.product_attribute_values?.map((v: any) => {
                    const on = selectedValueIds.has(v.id);
                    return (
                      <Badge key={v.id} variant={on ? "default" : "outline"} className="cursor-pointer"
                        onClick={() => toggleValue(a.id, v.id, !on)}>{v.name}</Badge>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <Button size="sm" onClick={generate} disabled={attrs.length === 0}>
          <Sparkles className="h-4 w-4 mr-1" />Gerar variantes
        </Button>
      </div>

      {/* Filters */}
      {variants.length > 0 && attrs.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 border rounded p-3 bg-muted/20">
          <div className="text-sm font-medium mr-2">Filtrar:</div>
          {attrs.map((a) => {
            const fullAttr = allAttrs.find((x) => x.id === a.attribute_id);
            return (
              <div key={a.id} className="space-y-1">
                <div className="text-xs text-muted-foreground">{a.product_attributes?.name}</div>
                <Select value={filters[a.attribute_id] || "all"} onValueChange={(v) => setFilters((p) => ({ ...p, [a.attribute_id]: v }))}>
                  <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {(fullAttr?.product_attribute_values || []).filter((v: any) => a.values.some((sv: any) => sv.value_id === v.id)).map((v: any) => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
          {Object.values(filters).some((v) => v && v !== "all") && (
            <Button size="sm" variant="ghost" onClick={() => setFilters({})}>Limpar filtros</Button>
          )}
        </div>
      )}

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="border rounded p-3 bg-primary/5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">{selected.size} selecionada(s)</div>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpar seleção</Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Preço extra</div>
              <Input className="h-8 w-28" type="number" step="0.01" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} placeholder="0,00" />
            </div>
            <Button size="sm" onClick={() => applyBulkPrice("set")}>Definir</Button>
            <Button size="sm" variant="outline" onClick={() => applyBulkPrice("add")}>Somar</Button>

            <div className="w-px h-8 bg-border mx-1" />

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Peso (kg)</div>
              <Input className="h-8 w-24" type="number" step="0.001" value={bulkWeight} onChange={(e) => setBulkWeight(e.target.value)} placeholder="0,000" />
            </div>
            <Button size="sm" onClick={applyBulkWeight}>Aplicar</Button>

            <div className="w-px h-8 bg-border mx-1" />

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Prefixo SKU</div>
              <Input className="h-8 w-32" value={skuPrefix} onChange={(e) => setSkuPrefix(e.target.value)} placeholder={productCode || "VAR"} />
            </div>
            <Button size="sm" onClick={applyBulkSku}>Gerar SKUs</Button>

            <div className="w-px h-8 bg-border mx-1" />

            <Button size="sm" variant="outline" onClick={() => applyBulkActive(true)}>Ativar</Button>
            <Button size="sm" variant="outline" onClick={() => applyBulkActive(false)}>Desativar</Button>
          </div>
        </div>
      )}

      {bulkErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Conflitos detectados ({bulkErrors.length})</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 space-y-0.5 text-xs mt-1 max-h-40 overflow-auto">
              {bulkErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
            <Button size="sm" variant="ghost" className="mt-1 h-6" onClick={() => setBulkErrors([])}>Fechar</Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Variants table */}
      <div className="space-y-2">
        <div className="font-semibold">Variantes ({filteredVariants.length}{filteredVariants.length !== variants.length ? ` de ${variants.length}` : ""})</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border">
            <thead className="bg-muted/40">
              <tr>
                <th className="p-2 w-8"><Checkbox checked={allFilteredSelected} onCheckedChange={toggleAllFiltered} /></th>
                <th className="p-2 w-16">Foto</th>
                <th className="text-left p-2">Combinação</th>
                <th className="text-left p-2 w-40">SKU</th>
                <th className="text-left p-2 w-32">Cód. barras</th>
                <th className="text-left p-2 w-28">Preço extra</th>
                <th className="text-left p-2 w-24">Peso</th>
                <th className="text-left p-2 w-16">Ativo</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {filteredVariants.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-muted-foreground py-6">Sem variantes</td></tr>
              ) : filteredVariants.map((v) => (
                <tr key={v.id} className={`border-t ${!v.active ? "opacity-50" : ""}`}>
                  <td className="p-2 text-center"><Checkbox checked={selected.has(v.id)} onCheckedChange={() => toggleOne(v.id)} /></td>
                  <td className="p-1">
                    <div className="relative w-12 h-12 border rounded bg-muted/30 flex items-center justify-center overflow-hidden group">
                      {v.image_url ? (
                        <>
                          <img src={v.image_url} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeImage(v)}
                            className="absolute top-0 right-0 bg-destructive text-destructive-foreground rounded-bl p-0.5 opacity-0 group-hover:opacity-100"
                            title="Remover foto"
                          ><X className="h-3 w-3" /></button>
                        </>
                      ) : (
                        <button type="button" onClick={() => fileRefs.current[v.id]?.click()} title="Enviar foto">
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        </button>
                      )}
                      {v.image_url && (
                        <button
                          type="button"
                          onClick={() => fileRefs.current[v.id]?.click()}
                          className="absolute inset-0 bg-black/40 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center"
                          title="Trocar foto"
                        ><Upload className="h-4 w-4" /></button>
                      )}
                      <input
                        ref={(el) => { fileRefs.current[v.id] = el; }}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(v, f); e.target.value = ""; }}
                      />
                    </div>
                  </td>
                  <td className="p-2">{(v.product_variant_values || []).map((x: any) => x.product_attribute_values?.name).join(" / ")}</td>
                  <td className="p-1">
                    <Input className={`h-8 ${rowErrors[v.id]?.sku ? "border-destructive focus-visible:ring-destructive" : ""}`} defaultValue={v.sku ?? ""} key={`sku-${v.id}-${v.sku}`} title={rowErrors[v.id]?.sku || ""} onBlur={(e) => e.target.value !== (v.sku ?? "") && updateVariant(v, { sku: e.target.value })} />
                    {rowErrors[v.id]?.sku && <div className="text-[10px] text-destructive mt-0.5">{rowErrors[v.id].sku}</div>}
                  </td>
                  <td className="p-1">
                    <Input className={`h-8 ${rowErrors[v.id]?.barcode ? "border-destructive focus-visible:ring-destructive" : ""}`} defaultValue={v.barcode ?? ""} key={`bc-${v.id}-${v.barcode}`} title={rowErrors[v.id]?.barcode || ""} onBlur={(e) => e.target.value !== (v.barcode ?? "") && updateVariant(v, { barcode: e.target.value })} />
                    {rowErrors[v.id]?.barcode && <div className="text-[10px] text-destructive mt-0.5">{rowErrors[v.id].barcode}</div>}
                  </td>
                  <td className="p-1"><Input className="h-8" type="number" step="0.01" defaultValue={v.price_extra} key={`px-${v.id}-${v.price_extra}`} onBlur={(e) => Number(e.target.value) !== Number(v.price_extra) && updateVariant(v, { price_extra: Number(e.target.value) })} /></td>
                  <td className="p-1"><Input className="h-8" type="number" step="0.001" defaultValue={v.weight ?? 0} key={`w-${v.id}-${v.weight}`} onBlur={(e) => Number(e.target.value) !== Number(v.weight ?? 0) && updateVariant(v, { weight: Number(e.target.value) })} /></td>
                  <td className="p-2 text-center"><input type="checkbox" checked={v.active} onChange={(e) => updateVariant(v, { active: e.target.checked })} /></td>
                  <td><Button variant="ghost" size="icon" onClick={() => removeVariant(v.id)}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
