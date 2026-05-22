import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdvancedFilters, FilterField, FilterValues } from "@/core/filters/AdvancedFilters";
import { ChevronDown, ChevronUp, Columns3, Star, BookmarkPlus, Trash2 } from "lucide-react";
import { useUserListView, type ListColumnPref } from "@/core/layout/useUserListView";
import { toast } from "sonner";

export type ConfigurableColumn<T> = {
  key: string;
  header: string;
  /** human-friendly label for the "Columns" picker (defaults to header). */
  label?: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
  sortKey?: string;
  defaultVisible?: boolean;
  /** Cannot be hidden by the user (e.g. primary identifier). */
  alwaysVisible?: boolean;
};

export function ConfigurableListView<T extends { id?: string }>({
  viewKey,
  title,
  breadcrumb,
  table,
  select,
  searchColumn,
  columns,
  rowLink,
  rowKey,
  createTo,
  orderBy = "created_at",
  ascending = false,
  filter,
  actions,
  filters,
  applyFilter,
}: {
  viewKey: string;
  title: string;
  breadcrumb?: { label: string; to?: string }[];
  table: string;
  select?: string;
  searchColumn?: string;
  columns: ConfigurableColumn<T>[];
  rowLink?: (row: T) => string;
  rowKey?: (row: T) => string;
  createTo?: string;
  orderBy?: string;
  ascending?: boolean;
  filter?: (q: any) => any;
  actions?: React.ReactNode;
  filters?: FilterField[];
  applyFilter?: (q: any, values: FilterValues) => any;
}) {
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<FilterValues>({});

  const defaultColumns: ListColumnPref[] = useMemo(
    () => columns.map((c, i) => ({ key: c.key, visible: c.defaultVisible !== false, order: i })),
    [columns]
  );

  const view = useUserListView(viewKey, {
    columns: defaultColumns,
    filters: {},
    sort: { key: orderBy, asc: ascending },
  });

  const sort = (view.state.sort as { key?: string; asc?: boolean });
  const sortKey = sort.key ?? orderBy;
  const sortAsc = sort.asc ?? ascending;

  // Merge user prefs with column definitions (handle new columns added after save)
  const visibleColumns = useMemo<ConfigurableColumn<T>[]>(() => {
    const prefMap = new Map(view.state.columns.map((c) => [c.key, c]));
    const withPref = columns.map((c, i) => {
      const p = prefMap.get(c.key);
      return {
        c,
        order: p?.order ?? i + 1000,
        visible: c.alwaysVisible ? true : (p ? p.visible : c.defaultVisible !== false),
      };
    });
    return withPref
      .filter((x) => x.visible)
      .sort((a, b) => a.order - b.order)
      .map((x) => x.c);
  }, [columns, view.state.columns]);

  const { data, isLoading } = useQuery({
    queryKey: [table, viewKey, search, select, sortKey, sortAsc, filterValues],
    queryFn: async () => {
      let q: any = supabase.from(table as any).select(select ?? "*").order(sortKey, { ascending: sortAsc });
      if (search && searchColumn) q = q.ilike(searchColumn, `%${search}%`);
      if (filter) q = filter(q);
      if (applyFilter) q = applyFilter(q, filterValues);
      const { data, error } = await q.limit(500);
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });

  const toggleSort = (col: ConfigurableColumn<T>) => {
    if (!col.sortable) return;
    const k = col.sortKey ?? col.key;
    view.update({
      sort: sortKey === k ? { key: k, asc: !sortAsc } : { key: k, asc: true },
    });
  };

  const toggleColumn = (key: string) => {
    const col = columns.find((c) => c.key === key);
    if (!col || col.alwaysVisible) return;
    const map = new Map(view.state.columns.map((c) => [c.key, c]));
    const cur = map.get(key);
    if (cur) map.set(key, { ...cur, visible: !cur.visible });
    else map.set(key, { key, visible: false, order: columns.findIndex((c) => c.key === key) });
    // Ensure all defined columns have an entry
    const merged = columns.map((c, i) => map.get(c.key) ?? { key: c.key, visible: c.defaultVisible !== false, order: i });
    view.update({ columns: merged });
  };

  const moveColumn = (key: string, dir: -1 | 1) => {
    const ordered = [...columns]
      .map((c, i) => {
        const p = view.state.columns.find((x) => x.key === c.key);
        return { key: c.key, order: p?.order ?? i, visible: p ? p.visible : c.defaultVisible !== false };
      })
      .sort((a, b) => a.order - b.order);
    const idx = ordered.findIndex((c) => c.key === key);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= ordered.length) return;
    [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
    view.update({ columns: ordered.map((c, i) => ({ ...c, order: i })) });
  };

  const [newViewName, setNewViewName] = useState("");
  const saveNewView = async () => {
    if (!newViewName.trim()) return toast.error("Indique um nome para a vista");
    const r = await view.saveAs(newViewName.trim());
    if (r) {
      toast.success(`Vista "${r.name}" guardada`);
      setNewViewName("");
    } else {
      toast.error("Não foi possível guardar (já existe ou sessão expirada)");
    }
  };

  const getRowKey = (row: T, i: number) => rowKey?.(row) ?? row.id ?? String(i);

  return (
    <>
      <PageHeader
        title={title}
        breadcrumb={breadcrumb}
        onSearch={searchColumn ? setSearch : undefined}
        createTo={createTo}
        actions={actions}
      />
      <PageBody>
        <Card className="p-3 mb-3 flex flex-wrap items-center gap-2">
          {filters && filters.length > 0 && (
            <AdvancedFilters fields={filters} onChange={setFilterValues} storageKey={`view-${viewKey}`} />
          )}

          {/* Columns picker */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="h-4 w-4 mr-1" /> Colunas
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 max-h-[70vh] overflow-y-auto p-2 space-y-1">
              {columns.map((c, i) => {
                const pref = view.state.columns.find((x) => x.key === c.key);
                const visible = c.alwaysVisible ? true : pref ? pref.visible : c.defaultVisible !== false;
                return (
                  <div key={c.key} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50">
                    <Checkbox
                      checked={visible}
                      disabled={c.alwaysVisible}
                      onCheckedChange={() => toggleColumn(c.key)}
                    />
                    <span className="text-sm flex-1 truncate">{c.label ?? c.header}</span>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveColumn(c.key, -1)} aria-label="Subir">
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveColumn(c.key, 1)} aria-label="Descer">
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
              <div className="pt-2 border-t flex justify-end">
                <Button size="sm" variant="ghost" onClick={view.resetToDefaults}>Repor predefinição</Button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Saved views */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Star className="h-4 w-4 mr-1" />
                {view.currentViewId
                  ? view.savedViews.find((v) => v.id === view.currentViewId)?.name ?? "Vistas"
                  : "Vistas"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs">Minhas vistas</DropdownMenuLabel>
              {view.savedViews.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">Sem vistas guardadas</div>
              )}
              {view.savedViews.map((v) => (
                <div key={v.id} className="flex items-center gap-1 px-1">
                  <DropdownMenuItem className="flex-1" onClick={() => view.switchTo(v.id)}>
                    <span className="flex-1 truncate">{v.name}</span>
                    {v.is_default && <Star className="h-3 w-3 text-amber-500" />}
                  </DropdownMenuItem>
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    onClick={(e) => { e.preventDefault(); void view.setDefault(v.id); }}
                    aria-label="Definir como predefinida"
                  >
                    <Star className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    onClick={(e) => { e.preventDefault(); void view.remove(v.id); }}
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <DropdownMenuSeparator />
              <div className="p-2 space-y-2">
                <Input
                  placeholder="Nome da vista…"
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  className="h-8"
                />
                <Button size="sm" className="w-full" onClick={saveNewView}>
                  <BookmarkPlus className="h-3 w-3 mr-1" /> Guardar vista atual
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </Card>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState title="Nenhum registo" description="Sem dados para os filtros atuais." />
        ) : (
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {visibleColumns.map((c) => {
                    const k = c.sortKey ?? c.key;
                    const active = sortKey === k;
                    return (
                      <th
                        key={c.key}
                        onClick={() => toggleSort(c)}
                        className={"text-left font-medium px-3 py-2 select-none " + (c.sortable ? "cursor-pointer hover:bg-muted " : "") + (c.className ?? "")}
                      >
                        <span className="inline-flex items-center gap-1">
                          {c.header}
                          {c.sortable && active && (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => {
                  const key = getRowKey(row, i);
                  if (rowLink) {
                    return (
                      <tr key={key} className="o-list-row">
                        <td colSpan={visibleColumns.length} className="p-0">
                          <Link
                            to={rowLink(row)}
                            className="grid w-full"
                            style={{ gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(0,1fr))` }}
                          >
                            {visibleColumns.map((c) => (
                              <div key={c.key} className={"px-3 py-2 " + (c.className ?? "")}>
                                {c.render ? c.render(row) : (row as any)[c.key]}
                              </div>
                            ))}
                          </Link>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={key} className="o-list-row">
                      {visibleColumns.map((c) => (
                        <td key={c.key} className={"px-3 py-2 " + (c.className ?? "")}>
                          {c.render ? c.render(row) : (row as any)[c.key]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </>
  );
}
