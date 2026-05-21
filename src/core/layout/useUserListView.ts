import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/core/auth/AuthProvider";

export type ListColumnPref = {
  key: string;
  visible: boolean;
  /** lower = earlier */
  order: number;
};

export type ListSortPref = { key: string; asc: boolean } | Record<string, never>;

export type ListViewState = {
  columns: ListColumnPref[];
  filters: Record<string, unknown>;
  sort: ListSortPref;
};

export type SavedListView = {
  id: string;
  name: string;
  is_default: boolean;
  columns: ListColumnPref[];
  filters: Record<string, unknown>;
  sort: ListSortPref;
};

const lsKey = (k: string) => `list-view:${k}`;

function safeRead(viewKey: string): ListViewState | null {
  try {
    const raw = localStorage.getItem(lsKey(viewKey));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    return {
      columns: Array.isArray(v.columns) ? v.columns : [],
      filters: typeof v.filters === "object" && v.filters ? v.filters : {},
      sort: typeof v.sort === "object" && v.sort ? v.sort : {},
    };
  } catch {
    return null;
  }
}

function safeWrite(viewKey: string, state: ListViewState) {
  try { localStorage.setItem(lsKey(viewKey), JSON.stringify(state)); } catch {}
}

/**
 * Per-user persistent state for ConfigurableListView.
 * - Loads default view (DB) if logged in; falls back to localStorage; falls back to provided defaults.
 * - Debounces saves to DB to avoid write storms.
 * - Always safe: on corrupted preference returns defaults.
 */
export function useUserListView(viewKey: string, defaults: ListViewState) {
  const { user } = useAuth();
  const initial = safeRead(viewKey) ?? defaults;
  const [state, setState] = useState<ListViewState>(initial);
  const [savedViews, setSavedViews] = useState<SavedListView[]>([]);
  const [currentViewId, setCurrentViewId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHydrated = useRef(false);

  // Load saved views + default once auth is known
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_list_views")
        .select("id,name,is_default,columns,filters,sort")
        .eq("user_id", user.id)
        .eq("view_key", viewKey)
        .order("name");
      if (cancelled || error || !data) return;
      const rows = data as unknown as SavedListView[];
      setSavedViews(rows);
      if (!isHydrated.current) {
        isHydrated.current = true;
        const def = rows.find((r) => r.is_default);
        if (def) {
          setState({ columns: def.columns ?? [], filters: def.filters ?? {}, sort: def.sort ?? {} });
          setCurrentViewId(def.id);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, viewKey]);

  // Persist locally + debounce DB update of current view (if any)
  useEffect(() => {
    safeWrite(viewKey, state);
    if (!user || !currentViewId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await supabase
        .from("user_list_views")
        .update({ columns: state.columns, filters: state.filters, sort: state.sort })
        .eq("id", currentViewId)
        .eq("user_id", user.id);
    }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [state, user?.id, currentViewId, viewKey]);

  const update = useCallback((patch: Partial<ListViewState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  const saveAs = useCallback(async (name: string, asDefault = false) => {
    if (!user) return null;
    if (asDefault) {
      await supabase
        .from("user_list_views")
        .update({ is_default: false })
        .eq("user_id", user.id)
        .eq("view_key", viewKey);
    }
    const { data, error } = await supabase
      .from("user_list_views")
      .insert({
        user_id: user.id,
        view_key: viewKey,
        name,
        is_default: asDefault,
        columns: state.columns,
        filters: state.filters,
        sort: state.sort,
      })
      .select("id,name,is_default,columns,filters,sort")
      .single();
    if (error || !data) return null;
    const row = data as unknown as SavedListView;
    setSavedViews((p) => [...p.filter((v) => v.name !== name), row]);
    setCurrentViewId(row.id);
    return row;
  }, [state, user?.id, viewKey]);

  const switchTo = useCallback((id: string) => {
    const v = savedViews.find((x) => x.id === id);
    if (!v) return;
    setState({ columns: v.columns ?? [], filters: v.filters ?? {}, sort: v.sort ?? {} });
    setCurrentViewId(v.id);
  }, [savedViews]);

  const setDefault = useCallback(async (id: string) => {
    if (!user) return;
    await supabase
      .from("user_list_views")
      .update({ is_default: false })
      .eq("user_id", user.id)
      .eq("view_key", viewKey);
    await supabase
      .from("user_list_views")
      .update({ is_default: true })
      .eq("id", id)
      .eq("user_id", user.id);
    setSavedViews((p) => p.map((v) => ({ ...v, is_default: v.id === id })));
  }, [user?.id, viewKey]);

  const remove = useCallback(async (id: string) => {
    if (!user) return;
    await supabase.from("user_list_views").delete().eq("id", id).eq("user_id", user.id);
    setSavedViews((p) => p.filter((v) => v.id !== id));
    if (currentViewId === id) setCurrentViewId(null);
  }, [user?.id, currentViewId]);

  const resetToDefaults = useCallback(() => {
    setState(defaults);
    setCurrentViewId(null);
    try { localStorage.removeItem(lsKey(viewKey)); } catch {}
  }, [defaults, viewKey]);

  return {
    state,
    update,
    savedViews,
    currentViewId,
    saveAs,
    switchTo,
    setDefault,
    remove,
    resetToDefaults,
  };
}
