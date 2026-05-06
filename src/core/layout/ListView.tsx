import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState } from "@/core/layout/PageHeader";

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
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
}) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: [table, search, select, orderBy, ascending],
    queryFn: async () => {
      let q: any = supabase.from(table as any).select(select ?? "*").order(orderBy, { ascending });
      if (search && searchColumn) q = q.ilike(searchColumn, `%${search}%`);
      if (filter) q = filter(q);
      const { data, error } = await q.limit(200);
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });

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
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState title="Nenhum registro" description="Comece criando o primeiro registro." />
        ) : (
          <div className="border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className={"text-left font-medium px-3 py-2 " + (c.className ?? "")}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row) => {
                  const cells = columns.map((c) => (
                    <td key={c.key} className={"px-3 py-2 " + (c.className ?? "")}>
                      {c.render ? c.render(row) : (row as any)[c.key]}
                    </td>
                  ));
                  return (
                    <tr key={row.id} className="o-list-row">
                      {rowLink ? (
                        <td colSpan={columns.length} className="p-0">
                          <Link to={rowLink(row)} className="grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0,1fr))` }}>
                            {cells}
                          </Link>
                        </td>
                      ) : (
                        cells
                      )}
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
