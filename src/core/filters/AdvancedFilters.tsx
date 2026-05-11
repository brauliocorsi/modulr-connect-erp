import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter, Star, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";

export type FilterField =
  | { key: string; label: string; type: "text" }
  | { key: string; label: string; type: "date" }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[] };

export type FilterValues = Record<string, string>;

export function AdvancedFilters({
  fields,
  onChange,
  storageKey,
  defaults,
}: {
  fields: FilterField[];
  onChange?: (values: FilterValues) => void;
  /** When set, the chosen filters are persisted (DB per-user + localStorage fallback) and re-applied on mount. */
  storageKey?: string;
  /** Built-in defaults applied when there are no URL params and no saved preference. */
  defaults?: FilterValues;
}) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const initRef = useRef(false);

  const readInitial = (): FilterValues => {
    const fromUrl: FilterValues = {};
    let hasUrl = false;
    fields.forEach((f) => {
      const v = params.get(f.key);
      if (v) { fromUrl[f.key] = v; hasUrl = true; }
    });
    if (hasUrl) return fromUrl;
    if (storageKey) {
      try {
        const raw = localStorage.getItem(`adv-filters:${storageKey}`);
        if (raw) {
          const parsed = JSON.parse(raw) as FilterValues;
          if (parsed && typeof parsed === "object") return parsed;
        }
      } catch {}
    }
    return { ...(defaults ?? {}) };
  };

  const [values, setValues] = useState<FilterValues>(readInitial);
  const [draft, setDraft] = useState<FilterValues>(values);

  // Sync URL with initial values once
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const np = new URLSearchParams(params);
    let changed = false;
    fields.forEach((f) => {
      const cur = np.get(f.key) ?? "";
      const next = values[f.key] ?? "";
      if (cur !== next) {
        if (next) np.set(f.key, next); else np.delete(f.key);
        changed = true;
      }
    });
    if (changed) setParams(np, { replace: true });
    // eslint-disable-next-line
  }, []);

  // Load per-user saved preference from DB once user is known.
  useEffect(() => {
    if (!storageKey || !user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_filter_preferences")
        .select("values")
        .eq("user_id", user.id)
        .eq("storage_key", storageKey)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const dbVals = (data.values || {}) as FilterValues;
      // Mirror to localStorage for offline/next-load
      try { localStorage.setItem(`adv-filters:${storageKey}`, JSON.stringify(dbVals)); } catch {}
      // Only apply if user hasn't changed anything via URL
      const urlHas = fields.some((f) => params.get(f.key));
      if (urlHas) return;
      setValues(dbVals);
      setDraft(dbVals);
      const np = new URLSearchParams(params);
      fields.forEach((f) => {
        if (dbVals[f.key]) np.set(f.key, dbVals[f.key]);
        else np.delete(f.key);
      });
      setParams(np, { replace: true });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [user?.id, storageKey]);

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

  const saveAsDefault = async () => {
    if (!storageKey) return;
    try { localStorage.setItem(`adv-filters:${storageKey}`, JSON.stringify(draft)); } catch {}
    if (!user) {
      toast.success("Filtros guardados como padrão (neste dispositivo)");
      return;
    }
    const { error } = await supabase
      .from("user_filter_preferences")
      .upsert({ user_id: user.id, storage_key: storageKey, values: draft }, { onConflict: "user_id,storage_key" });
    if (error) toast.error("Não foi possível guardar na conta");
    else toast.success("Filtros guardados como padrão na sua conta");
  };

  const clearSavedDefault = async () => {
    if (!storageKey) return;
    try { localStorage.removeItem(`adv-filters:${storageKey}`); } catch {}
    if (user) {
      await supabase
        .from("user_filter_preferences")
        .delete()
        .eq("user_id", user.id)
        .eq("storage_key", storageKey);
    }
    toast.success("Padrão removido");
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
            {Object.keys(values).length > 0 && (
              <span className="ml-1 text-[10px] bg-primary text-primary-foreground rounded-full px-1.5">{Object.keys(values).length}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 space-y-3 max-h-[70vh] overflow-y-auto">
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
          <div className="flex flex-wrap gap-2 pt-1 border-t">
            <Button size="sm" onClick={apply}>Aplicar</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft({})}>Limpar</Button>
            {storageKey && (
              <>
                <Button size="sm" variant="outline" onClick={saveAsDefault} title="Guarda os filtros atuais como padrão na sua conta (sincroniza entre dispositivos)">
                  <Star className="h-3 w-3 mr-1" /> Guardar como padrão
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSavedDefault}>Apagar padrão</Button>
              </>
            )}
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
