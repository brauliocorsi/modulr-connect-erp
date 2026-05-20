import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function chain(data: unknown) {
  const q: any = {
    select: () => q, eq: () => q, ilike: () => q, or: () => q, order: () => q, limit: () => q,
    then: (cb: any) => Promise.resolve({ data, error: null }).then(cb),
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => {
      if (t === "work_centers") return chain([
        { id: "wc1", code: "MTG", name: "Montagem 1", type: "assembly", capacity_per_day: 8, efficiency_percent: 85, cost_per_hour: 12, active: true, warehouse_id: null, warehouses: null },
      ]);
      if (t === "manufacturing_operations") return chain([
        { id: "op1", code: "CUT", name: "Corte", default_work_center_id: "wc1", requires_machine: true, requires_employee: true, requires_quality_check: false, active: true, work_centers: { name: "Montagem 1", code: "MTG" } },
      ]);
      if (t === "stock_packages") return chain([
        { id: "p1", package_ref: "PKG-001", qty: 1, condition: "damaged", status: "stored", disposition_status: null, current_location_id: null, service_case_id: null, product_id: "prod1", sale_order_id: null, updated_at: new Date().toISOString(), products: { name: "Cadeira" }, stock_locations: null, sale_orders: null },
      ]);
      if (t === "service_case_items") return chain([
        { id: "ci1", service_case_id: "sc1", qty: 1, status: "open", issue_type: "defect", required_action: "repair", repair_status: "pending", repair_result: null, repair_started_at: null, repair_completed_at: null, notes: null, products: { name: "Mesa" }, stock_packages: { package_ref: "PKG-002" }, service_cases: { case_number: "SC-0001", customer_id: null, status: "open", partners: null } },
      ]);
      if (t === "customer_portal_tokens") return chain([
        { id: "t1", scope: "order_status", status: "active", expires_at: new Date(Date.now() + 86400000).toISOString(), used_at: null, revoked_at: null, created_at: new Date().toISOString(), customer_id: "c1", sale_order_id: "so1", service_case_id: null, partners: { name: "Cliente X" }, sale_orders: { name: "SO-0001" }, service_cases: null },
      ]);
      return chain([]);
    },
  },
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

describe("F25-A operational pages", () => {
  it("WorkCentersPage renderiza linha", async () => {
    const { default: Page } = await import("@/modules/manufacturing/pages/WorkCentersPage");
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText("Montagem 1")).toBeTruthy());
  });

  it("OperationsPage renderiza centro de trabalho associado", async () => {
    const { default: Page } = await import("@/modules/manufacturing/pages/OperationsPage");
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText("Corte")).toBeTruthy());
  });

  it("DamagedStockPage mostra pacotes danificados", async () => {
    const { default: Page } = await import("@/modules/inventory/pages/DamagedStockPage");
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText("Cadeira")).toBeTruthy());
  });

  it("QuarantinePage renderiza sem erro", async () => {
    const { default: Page } = await import("@/modules/inventory/pages/QuarantinePage");
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText("Quarentena")).toBeTruthy());
  });

  it("ServiceRepairsPage renderiza reparações", async () => {
    const { default: Page } = await import("@/modules/service/pages/ServiceRepairsPage");
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText("SC-0001")).toBeTruthy());
  });

  it("PortalTokensPage mostra token ativo", async () => {
    const { default: Page } = await import("@/modules/helpdesk/pages/PortalTokensPage");
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText("Cliente X")).toBeTruthy());
  });
});
