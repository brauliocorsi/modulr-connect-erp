import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter, X } from "lucide-react";

export type FilterField =
  | { key: string; label: string; type: "text" }
  | { key: string; label: string; type: "date" }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[] };

export type FilterValues = Record<string, string>;

export function AdvancedFilters({
  fields,
  onChange,
}: {
  fields: FilterField[];
  onChange?: (values: FilterValues) => void;
}) {
  const [params, setParams] = useSearchParams();
  const initial: FilterValues = {};
  fields.forEach((f) => {
    const v = params.get(f.key);
    if (v) initial[f.key] = v;
  });
  const [values, setValues] = useState<FilterValues>(initial);
  const [draft, setDraft] = useState<FilterValues>(initial);

  useEffect(() => {
    onChange?.(values);
  }, [values]); // eslint-disable-line

  const apply = () => {
    setValues(draft);
    const np = new URLSearchParams(params);
    fields.forEach((f) => {
      if (draft[f.key]) np.set(f.key, draft[f.key]);
      else np.delete(f.key);
    });
    setParams(np, { replace: true });
  };

  const clearOne = (key: string) => {
    const next = { ...values };
    delete next[key];
    setValues(next);
    setDraft(next);
    const np = new URLSearchParams(params);
    np.delete(key);
    setParams(np, { replace: true });
  };

  const clearAll = () => {
    setValues({});
    setDraft({});
    const np = new URLSearchParams(params);
    fields.forEach((f) => np.delete(f.key));
    setParams(np, { replace: true });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-1" /> Filtros
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-3">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              {f.type === "select" ? (
                <Select value={draft[f.key] ?? ""} onValueChange={(v) => setDraft({ ...draft, [f.key]: v === "__all__" ? "" : v })}>
                  <SelectTrigger className="h-8"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    {f.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-8"
                  type={f.type === "date" ? "date" : "text"}
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              )}
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={apply}>Aplicar</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft({})}>Limpar</Button>
          </div>
        </PopoverContent>
      </Popover>
      {Object.entries(values).map(([k, v]) => {
        const f = fields.find((x) => x.key === k);
        if (!f || !v) return null;
        const display = f.type === "select" ? f.options.find((o) => o.value === v)?.label ?? v : v;
        return (
          <span key={k} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded">
            <span className="text-muted-foreground">{f.label}:</span> {display}
            <button onClick={() => clearOne(k)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
          </span>
        );
      })}
      {Object.keys(values).length > 0 && (
        <Button size="sm" variant="ghost" onClick={clearAll}>Limpar tudo</Button>
      )}
    </div>
  );
}
