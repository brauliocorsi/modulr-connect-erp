// F26-B — Realtime hooks for critical operational flows.
// Each hook wires a set of postgres tables to React Query invalidations
// using the centralised F26-A primitives. They are read-only.

import { useCallback } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRealtimeChannel, type RealtimeFilter } from "./useRealtimeChannel";

type Enabled = { enabled?: boolean };

/**
 * Generic helper: subscribe to a set of tables and invalidate a set of
 * query keys when *any* of them fires. Debounced (default 300ms) so a
 * burst from a single RPC does not cause a refetch storm.
 */
export function useOperationalRealtime(opts: {
  channel: string;
  tables: string[];
  queryKeys: QueryKey[];
  enabled?: boolean;
  debounceMs?: number;
  onEvent?: () => void;
}) {
  const qc = useQueryClient();
  const filters: RealtimeFilter[] = opts.tables.map((t) => ({ table: t, event: "*" }));
  const onChange = useCallback(() => {
    for (const k of opts.queryKeys) {
      qc.invalidateQueries({ queryKey: k });
    }
    opts.onEvent?.();
  }, [qc, opts.queryKeys, opts.onEvent]);
  useRealtimeChannel({
    channel: opts.channel,
    filters,
    onChange,
    enabled: opts.enabled,
    debounceMs: opts.debounceMs ?? 300,
  });
}

// ── 1. Payments ─────────────────────────────────────────────────────────
export function usePaymentsRealtime({ enabled = true, onChange }: Enabled & { onChange?: () => void } = {}) {
  useRealtimeChannel({
    channel: "payments-page",
    filters: [
      { table: "customer_payments" },
      { table: "cash_movements" },
      { table: "cash_sessions" },
      { table: "bank_reconciliation_lines" },
      { table: "supplier_payments" },
    ],
    onChange: () => onChange?.(),
    enabled,
    debounceMs: 400,
  });
}

// ── 2. Picking / Barcode ────────────────────────────────────────────────
export function usePickingRealtime({
  pickingId,
  enabled = true,
  onChange,
}: Enabled & { pickingId?: string | null; onChange?: () => void }) {
  const filters: RealtimeFilter[] = [
    { table: "stock_pickings" },
    { table: "stock_packages" },
  ];
  if (pickingId) {
    filters.push({ table: "stock_moves", filter: `picking_id=eq.${pickingId}` });
  } else {
    filters.push({ table: "stock_moves" });
  }
  useRealtimeChannel({
    channel: `picking-scan-${pickingId ?? "list"}`,
    filters,
    onChange: () => onChange?.(),
    enabled,
    debounceMs: 500, // higher debounce — avoid clobbering optimistic scan state
  });
}

// ── 3. Route Detail ─────────────────────────────────────────────────────
export function useRouteRealtime({
  routeId,
  enabled = true,
}: Enabled & { routeId?: string | null }) {
  useOperationalRealtime({
    channel: `route-detail-${routeId ?? "none"}`,
    tables: [
      "delivery_routes",
      "delivery_schedules",
      "vehicle_route_manifest",
      "stock_packages",
      "customer_payments",
      "cash_movements",
      "delivery_route_orders",
      "dock_transfers",
    ],
    queryKeys: [
      ["route-detail", routeId],
      ["route-orders", routeId],
      ["route-manifest", routeId],
      ["route-docks", routeId],
      ["route-capacity", routeId],
      ["route-pickings", routeId],
    ],
    enabled: enabled && !!routeId,
    debounceMs: 400,
  });
}

// ── 4. Manufacturing Order Detail ───────────────────────────────────────
export function useManufacturingRealtime({
  moId,
  enabled = true,
}: Enabled & { moId?: string | null }) {
  useOperationalRealtime({
    channel: `mo-detail-${moId ?? "none"}`,
    tables: [
      "manufacturing_orders",
      "mo_components",
      "mo_operations",
      "mo_issues",
      "mo_quality_checks",
      "work_orders",
      "stock_moves",
      "purchase_needs",
    ],
    queryKeys: [
      ["manufacturing_order", moId],
      ["mo-comps", moId],
      ["mo-ops", moId],
      ["mo-iss", moId],
      ["mo-qc", moId],
      ["work-orders", moId],
      ["purchase_needs"],
    ],
    enabled: enabled && !!moId,
    debounceMs: 400,
  });
}

// ── 5. Indicators ───────────────────────────────────────────────────────
/**
 * Indicators aggregates ~28 cards. We use a high debounce (2.5s) and a
 * single bulk invalidation of the ["indicator"] query prefix.
 */
export function useIndicatorsRealtime({ enabled = true }: Enabled = {}) {
  const qc = useQueryClient();
  const onChange = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["indicator"] });
  }, [qc]);
  useRealtimeChannel({
    channel: "indicators-page",
    filters: [
      { table: "activity_events", event: "INSERT" },
      { table: "notifications", event: "INSERT" },
      { table: "sale_orders" },
      { table: "manufacturing_orders" },
      { table: "purchase_needs" },
      { table: "delivery_routes" },
      { table: "customer_tickets" },
      { table: "service_cases" },
    ],
    onChange,
    enabled,
    debounceMs: 2500,
  });
}
