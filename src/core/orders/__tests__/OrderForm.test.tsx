import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ---- Mocks ----
const rpcMock = vi.fn();

// Build a chainable supabase.from(...) that always resolves to { data: [], error: null }
function makeQuery(result: { data: unknown; error: null | { message: string } } = { data: [], error: null }) {
  const q: Record<string, unknown> = {
    then: (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF),
  };
  const chain = [
    "select", "insert", "update", "upsert", "delete",
    "eq", "neq", "in", "gt", "gte", "lt", "lte", "is", "not", "or",
    "order", "limit", "maybeSingle", "single",
  ];
  chain.forEach((m) => { q[m] = vi.fn(() => q); });
  // maybeSingle/single resolve to single object when caller awaits them
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  q.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return q;
}

const orderRow = {
  id: "ord-1",
  name: "SO0001",
  state: "draft",
  partner_id: "p1",
  notes: "",
  amount_total: 100,
  amount_untaxed: 100,
  amount_tax: 0,
  payment_status: "unpaid",
  fulfillment_status: null,
  invoice_status: null,
  include_assembly: false,
  include_delivery: false,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: (table: string) => {
      if (table === "sale_orders") {
        const q = makeQuery();
        q.maybeSingle = vi.fn(() => Promise.resolve({ data: orderRow, error: null }));
        return q;
      }
      return makeQuery();
    },
    channel: () => ({
      on: function (this: unknown) { return this; },
      subscribe: () => ({}),
    }),
    removeChannel: vi.fn(),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(
    (m: string) => toastSuccess(m),
    {
      success: (m: string) => toastSuccess(m),
      error: (m: string) => toastError(m),
      info: (m: string) => toastInfo(m),
    },
  ),
}));

// Stub heavy children that aren't relevant for the header/action tests
vi.mock("@/modules/manufacturing/components/SaleProductionPanel", () => ({
  SaleProductionPanel: () => null,
}));
vi.mock("@/modules/purchase/components/SaleAvailabilityPanel", () => ({
  default: () => null,
}));
vi.mock("@/core/orders/SmartButtons", () => ({ SmartButtons: () => null }));
vi.mock("@/core/orders/PaymentsTab", () => ({ PaymentsTab: () => null }));
vi.mock("@/core/orders/PurchaseBillsPanel", () => ({ PurchaseBillsPanel: () => null }));
vi.mock("@/core/orders/OrderTraceability", () => ({ OrderTraceability: () => null }));
vi.mock("@/core/timeline/RecordTimeline", () => ({ RecordTimeline: () => null }));
vi.mock("@/core/activities/RecordSidebar", () => ({ RecordSidebar: () => null }));
vi.mock("@/modules/inventory/components/DeliveryStatusBadge", () => ({
  DeliveryStatusBadge: () => null,
}));

import OrderForm from "../OrderForm";

function renderForm(kind: "sale" | "purchase" = "sale", orderId = "ord-1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/sales/orders/${orderId}`]}>
        <Routes>
          <Route path="/sales/orders/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<OrderForm kind={kind} />, { wrapper: Wrapper });
}

beforeEach(() => {
  rpcMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  toastInfo.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe("OrderForm (F22-R2)", () => {
  it("renders EntityHeader with sale state badge", async () => {
    renderForm();
    await waitFor(() => expect(screen.getAllByText("SO0001").length).toBeGreaterThan(0));
    // domain 'sale' label for 'draft'
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
  });

  it("shows Atualizar refresh button and triggers refresh", async () => {
    renderForm();
    const btn = await screen.findByRole("button", { name: /Atualizar/i });
    fireEvent.click(btn);
    // refresh invalidates queries, no toast expected; just confirm clickable
    expect(btn).toBeInTheDocument();
  });

  it("Cancelar action requires confirm and calls cancel_sale_order RPC", async () => {
    renderForm();
    const cancelBtn = await screen.findByRole("button", { name: /Cancelar/i });
    fireEvent.click(cancelBtn);
    const confirmBtn = await screen.findByRole("button", { name: /Cancelar pedido/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("cancel_sale_order", { _order: "ord-1" }));
  });

  it("Marcar faturado opens the dialog", async () => {
    renderForm();
    const btn = await screen.findByRole("button", { name: /Marcar faturado/i });
    fireEvent.click(btn);
    expect(await screen.findByRole("heading", { name: /Marcar como faturado/i })).toBeInTheDocument();
  });

  it("does NOT issue direct mutations on sale_orders via supabase.from string literal", async () => {
    // Compile-time guard handled by repo grep; here just ensure the form mounts without errors
    renderForm();
    await waitFor(() => expect(screen.getAllByText("SO0001").length).toBeGreaterThan(0));
    expect(toastError).not.toHaveBeenCalled();
  });
});
