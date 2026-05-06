import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FormHeader } from "@/core/layout/FormHeader";
import { PageBody } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save } from "lucide-react";
import { toast } from "sonner";

export type FieldOption = { value: string; label: string };
export type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "boolean" | "select" | "textarea" | "date";
  options?: FieldOption[];
  optionsFrom?: { table: string; value: string; label: string; filter?: (q: any) => any };
  required?: boolean;
  default?: any;
  placeholder?: string;
  span?: 1 | 2;
};

export function SimpleForm({
  table,
  title,
  basePath,
  breadcrumb,
  fields,
  onAfterSave,
}: {
  table: string;
  title: string;
  basePath: string;
  breadcrumb: { label: string; to?: string }[];
  fields: Field[];
  onAfterSave?: (id: string) => void;
}) {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const nav = useNavigate();
  const [row, setRow] = useState<any>(() => {
    const init: any = {};
    fields.forEach((f) => (init[f.name] = f.default ?? (f.type === "boolean" ? false : "")));
    return init;
  });
  const [opts, setOpts] = useState<Record<string, FieldOption[]>>({});

  useEffect(() => {
    (async () => {
      for (const f of fields) {
        if (f.optionsFrom) {
          let q: any = supabase.from(f.optionsFrom.table as any).select(`${f.optionsFrom.value}, ${f.optionsFrom.label}`);
          if (f.optionsFrom.filter) q = f.optionsFrom.filter(q);
          const { data } = await q.order(f.optionsFrom.label).limit(500);
          setOpts((p) => ({
            ...p,
            [f.name]: (data ?? []).map((d: any) => ({ value: d[f.optionsFrom!.value], label: d[f.optionsFrom!.label] })),
          }));
        }
      }
      if (!isNew) {
        const { data } = await supabase.from(table as any).select("*").eq("id", id!).maybeSingle();
        if (data) setRow(data);
      }
    })();
  }, [id, isNew, table]);

  const set = (k: string, v: any) => setRow((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    for (const f of fields) {
      if (f.required && (row[f.name] === "" || row[f.name] === null || row[f.name] === undefined)) {
        return toast.error(`Preencha ${f.label}`);
      }
    }
    const payload: any = {};
    fields.forEach((f) => {
      let v = row[f.name];
      if (v === "") v = null;
      if (f.type === "number") v = v === null ? null : Number(v);
      payload[f.name] = v;
    });
    if (isNew) {
      const { data, error } = await supabase.from(table as any).insert(payload).select("id").single();
      if (error) return toast.error(error.message);
      toast.success("Criado");
      const newId = (data as any).id;
      onAfterSave?.(newId);
      nav(`${basePath}/${newId}`);
    } else {
      const { error } = await supabase.from(table as any).update(payload).eq("id", id!);
      if (error) return toast.error(error.message);
      toast.success("Salvo");
      onAfterSave?.(id!);
    }
  };

  const remove = async () => {
    if (isNew) return;
    if (!confirm("Excluir?")) return;
    const { error } = await supabase.from(table as any).delete().eq("id", id!);
    if (error) return toast.error(error.message);
    toast.success("Excluído");
    nav(basePath);
  };

  return (
    <>
      <FormHeader
        title={isNew ? `Novo: ${title}` : row.name || row.code || title}
        breadcrumb={breadcrumb}
        backTo={basePath}
        onDelete={isNew ? undefined : remove}
        actions={
          <Button size="sm" onClick={save}>
            <Save className="h-4 w-4 mr-1" /> Salvar
          </Button>
        }
      />
      <PageBody>
        <Card className="p-6 grid sm:grid-cols-2 gap-4 max-w-3xl">
          {fields.map((f) => (
            <div key={f.name} className={"space-y-2 " + (f.span === 2 ? "sm:col-span-2" : "")}>
              <Label>{f.label}{f.required && " *"}</Label>
              {f.type === "boolean" ? (
                <div className="pt-1"><Switch checked={!!row[f.name]} onCheckedChange={(v) => set(f.name, v)} /></div>
              ) : f.type === "select" ? (
                <Select value={row[f.name] ?? ""} onValueChange={(v) => set(f.name, v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {(f.options ?? opts[f.name] ?? []).map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : f.type === "textarea" ? (
                <textarea className="w-full min-h-24 rounded-md border bg-background px-3 py-2 text-sm" value={row[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} />
              ) : (
                <Input
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  step={f.type === "number" ? "0.01" : undefined}
                  value={row[f.name] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
            </div>
          ))}
        </Card>
      </PageBody>
    </>
  );
}
