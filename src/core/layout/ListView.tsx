import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState } from "@/core/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { AdvancedFilters, FilterField, FilterValues } from "@/core/filters/AdvancedFilters";
import { ChevronDown, ChevronUp } from "lucide-react";

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
  /** Database column name to sort by (defaults to `key`) */
  sortKey?: string;
};

export function ListView<T extends { id: string }>({
  title,
  breadcrumb,
  table,
  select,
  searchColumn,
  columns,
  rowLink,
  createTo,
  orderBy = "created_at",
  ascending = false,
  filter,
  actions,
  filters,
  applyFilter,
}: {
  title: string;
  breadcrumb?: { label: string; to?: string }[];
  table: string;
  select?: string;
  searchColumn?: string;
  columns: Column<T>[];
  rowLink?: (row: T) => string;
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
  const [sort, setSort] = useState<{ key: string; asc: boolean }>({ key: orderBy, asc: ascending });

  const { data, isLoading } = useQuery({
    queryKey: [table, search, select, sort, filterValues],
    queryFn: async () => {
      let q: any = supabase.from(table as any).select(select ?? "*").order(sort.key, { ascending: sort.asc });
      if (search && searchColumn) q = q.ilike(searchColumn, `%${search}%`);
      if (filter) q = filter(q);
      if (applyFilter) q = applyFilter(q, filterValues);
      const { data, error } = await q.limit(500);
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });

  const toggleSort = (col: Column<T>) => {
    if (!col.sortable) return;
    const k = col.sortKey ?? col.key;
    setSort((p) => (p.key === k ? { key: k, asc: !p.asc } : { key: k, asc: true }));
  };

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
        {filters && filters.length > 0 && (
          <Card className="p-3 mb-3">
            <AdvancedFilters fields={filters} onChange={setFilterValues} />
          </Card>
        )}
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState title="Nenhum registro" description="Comece criando o primeiro registro." />
        ) : (
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {columns.map((c) => {
                    const k = c.sortKey ?? c.key;
                    const active = sort.key === k;
                    return (
                      <th
                        key={c.key}
                        onClick={() => toggleSort(c)}
                        className={"text-left font-medium px-3 py-2 select-none " + (c.sortable ? "cursor-pointer hover:bg-muted " : "") + (c.className ?? "")}
                      >
                        <span className="inline-flex items-center gap-1">
                          {c.header}
                          {c.sortable && active && (sort.asc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.map((row) => {
                  const href = rowLink ? rowLink(row) : undefined;
                  const onRowClick = href
                    ? (e: React.MouseEvent) => {
                        const t = e.target as HTMLElement;
                        if (t.closest("a,button,input,label,select,textarea,[data-no-row-nav]")) return;
                        if (e.metaKey || e.ctrlKey || e.shiftKey || (e as any).button === 1) {
                          window.open(href, "_blank");
                          return;
                        }
                        navigate(href);
                      }
                    : undefined;
                  return (
                    <tr
                      key={row.id}
                      className={"o-list-row border-t " + (href ? "cursor-pointer hover:bg-muted/40" : "")}
                      onClick={onRowClick}
                    >
                      {columns.map((c) => (
                        <td key={c.key} className={"px-3 py-2 align-middle " + (c.className ?? "")}>
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
