import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ORDERS = [
  {
    id: "po1", name: "PO-001", state: "draft", date_order: "2025-01-10", expected_date: "2025-01-20",
    amount_total: 1000, partner_id: "s1", warehouse_id: "w1", created_by: "u1",
    created_at: new Date().toISOString(),
    partners: { name: "Fornecedor A" }, warehouses: { name: "Armazém 1" },
  },
  {
    id: "po2", name: "PO-002", state: "confirmed", date_order: "2025-01-05", expected_date: null,
    amount_total: 500, partner_id: "s2", warehouse_id: null, created_by: "u1",
    created_at: new Date(Date.now() - 86400000).toISOString(),
    partners: { name: "Fornecedor B" }, warehouses: null,
  },
];

const fromMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...a: any[]) => fromMock(...a) },
}));

function makeBuilder(rows: any[]) {
  const b: any = {};
  ["select", "order", "limit", "eq", "in", "gte", "lte", "ilike", "not", "is"].forEach((m) => (b[m] = vi.fn().mockReturnValue(b)));
  b.then = (resolve: any) => resolve({ data: rows, error: null });
  return b;
}

beforeEach(() => {
  fromMock.mockReset();
  fromMock.mockImplementation((table: string) => {
    if (table === "purchase_orders") return makeBuilder(ORDERS);
    if (table === "partners") return makeBuilder([{ id: "s1", name: "Fornecedor A" }]);
    if (table === "warehouses") return makeBuilder([{ id: "w1", name: "Armazém 1" }]);
    if (table === "purchase_order_origins") return makeBuilder([]);
    return makeBuilder([]);
  });
});

import { PurchaseOrdersList } from "../PurchaseOrdersList";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PurchaseOrdersList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PurchaseOrdersList", () => {
  it("renders PO list", async () => {
    setup();
    expect(await screen.findByText("PO-001")).toBeInTheDocument();
    expect(screen.getByText("PO-002")).toBeInTheDocument();
    expect(screen.getByText("Fornecedor A")).toBeInTheDocument();
  });

  it("renders status badges via OperationalStatusBadge", async () => {
    setup();
    await screen.findByText("PO-001");
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
    expect(screen.getByText("Confirmado")).toBeInTheDocument();
  });

  it("triggers query when typing in search", async () => {
    setup();
    await screen.findByText("PO-001");
    const search = screen.getByPlaceholderText(/Buscar nº/);
    fireEvent.change(search, { target: { value: "PO-001" } });
    await waitFor(() => expect(fromMock).toHaveBeenCalledWith("purchase_orders"));
  });

  it("renders empty state when no orders", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "partners") return makeBuilder([]);
      if (table === "warehouses") return makeBuilder([]);
      return makeBuilder([]);
    });
    setup();
    expect(await screen.findByText(/Sem pedidos/)).toBeInTheDocument();
  });

  it("renders error state on query failure", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "purchase_orders") {
        const b = makeBuilder([]);
        b.then = (resolve: any) => resolve({ data: null, error: { message: "boom" } });
        return b;
      }
      return makeBuilder([]);
    });
    setup();
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});
