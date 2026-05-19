import { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingState } from "./states";
import { OperationalSearchInput } from "./OperationalSearchInput";
import { OperationalFiltersBar, type FilterDef, type FilterValue } from "./OperationalFiltersBar";
import { OperationalActionBar, type OperationalAction } from "./OperationalActionBar";
import { RefreshButton } from "./RefreshButton";
import { LastUpdated } from "./LastUpdated";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
  className?: string;
}

export interface OperationalDataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  isFetching?: boolean;
  onRowClick?: (row: T) => void;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  filters?: FilterDef[];
  filterValues?: Record<string, FilterValue>;
  onFilterChange?: (key: string, value: FilterValue) => void;
  onFiltersClear?: () => void;
  headerActions?: OperationalAction[];
  rowActions?: (row: T) => OperationalAction[];
  density?: "compact" | "normal";
  emptyTitle?: string;
  emptyDescription?: string;
  onRefresh?: () => void;
  lastUpdated?: Date | string | null;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPage: (page: number) => void;
  };
  className?: string;
}

export function OperationalDataTable<T>({
  columns,
  rows,
  getRowId,
  isLoading,
  error,
  isFetching,
  onRowClick,
  search,
  filters,
  filterValues,
  onFilterChange,
  onFiltersClear,
  headerActions,
  rowActions,
  density = "normal",
  emptyTitle = "Sem registos",
  emptyDescription,
  onRefresh,
  lastUpdated,
  pagination,
  className,
}: OperationalDataTableProps<T>) {
  const cellPad = density === "compact" ? "px-2 py-1.5" : "px-3 py-2";
  const errMessage = error instanceof Error ? error.message : error ? String((error as { message?: string })?.message ?? error) : null;

  return (
    <div className={cn("space-y-2", className)}>
      {(search || filters || headerActions || onRefresh) && (
        <div className="flex flex-wrap items-center gap-2 p-2 bg-card border rounded-lg">
          {search && (
            <OperationalSearchInput
              value={search.value}
              onChange={search.onChange}
              placeholder={search.placeholder}
            />
          )}
          {filters && filters.length > 0 && filterValues && onFilterChange && (
            <OperationalFiltersBar
              filters={filters}
              values={filterValues}
              onChange={onFilterChange}
              onClear={onFiltersClear}
            />
          )}
          <div className="flex-1" />
          {lastUpdated && <LastUpdated value={lastUpdated} />}
          {onRefresh && <RefreshButton onRefresh={onRefresh} isFetching={isFetching} />}
          {headerActions && headerActions.length > 0 && <OperationalActionBar actions={headerActions} />}
        </div>
      )}

      {isLoading ? (
        <LoadingState />
      ) : errMessage ? (
        <ErrorState description={errMessage} onRetry={onRefresh} />
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={cn(
                      "h-9",
                      cellPad,
                      c.align === "right" && "text-right",
                      c.align === "center" && "text-center",
                      c.className,
                    )}
                  >
                    {c.header}
                  </TableHead>
                ))}
                {rowActions && <TableHead className={cn("h-9 w-1", cellPad)} aria-label="Ações" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const id = getRowId(row);
                const acts = rowActions?.(row);
                return (
                  <TableRow
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={onRowClick ? "cursor-pointer" : undefined}
                  >
                    {columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={cn(
                          cellPad,
                          c.align === "right" && "text-right",
                          c.align === "center" && "text-center",
                          c.className,
                        )}
                      >
                        {c.cell(row)}
                      </TableCell>
                    ))}
                    {acts && (
                      <TableCell className={cellPad} onClick={(e) => e.stopPropagation()}>
                        <OperationalActionBar actions={acts} align="end" />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {pagination && pagination.total > pagination.pageSize && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>
            {pagination.page * pagination.pageSize + 1}–
            {Math.min((pagination.page + 1) * pagination.pageSize, pagination.total)} de {pagination.total}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={pagination.page === 0}
            onClick={() => pagination.onPage(pagination.page - 1)}
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={(pagination.page + 1) * pagination.pageSize >= pagination.total}
            onClick={() => pagination.onPage(pagination.page + 1)}
            aria-label="Próxima"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
