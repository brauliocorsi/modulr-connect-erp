import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const NEEDS = [
  {
    id: "n1", qty_needed: 5, origin_kind: "manufacturing", state: "pending",
    needed_by: null, priority: 1, created_at: new Date().toISOString(), notes: null,
    product_variant_id: null,
    products: { id: "p1", name: "Madeira", internal_ref: "MAD-01" },
    product_variants: null,
    partners: { id: "s1", name: "Fornecedor A" },
    sale_orders: null,
    manufacturing_orders: { id: "mo1", code: "MO-001" },
    purchase_orders: null,
  },
  {
    id: "n2", qty_needed: 2, origin_kind: "sale", state: "po_created",
    needed_by: null, priority: 0, created_at: new Date().toISOString(), notes: null,
    product_variant_id: null,
    products: { id: "p2", name: "Parafuso", internal_ref: "PAR-01" },
    product_variants: { id: "v1", sku: "VAR-1" },
    partners: null,
    sale_orders: { id: "so1", name: "SO-001" },
    manufacturing_orders: null,
    purchase_orders: { id: "po1", name: "PO-001", state: "draft" },
  },
];

const fromMock = vi.fn();
const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: any[]) => fromMock(...a),
    rpc: (...a: any[]) => rpcMock(...a),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: any[]) => toastSuccess(...a),
    error: (...a: any[]) => toastError(...a),
  },
}));

function makeBuilder(rows: any[]) {
  const b: any = {};
  ["select", "order", "limit", "eq", "in", "not", "is"].forEach((m) => (b[m] = vi.fn().mockReturnValue(b)));
  b.then = (resolve: any) => resolve({ data: rows, error: null });
  return b;
}

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  fromMock.mockImplementation((table: string) => {
    if (table === "purchase_needs") return makeBuilder(NEEDS);
    if (table === "partners") return makeBuilder([{ id: "s1", name: "Fornecedor A" }]);
    return makeBuilder([]);
  });
  rpcMock.mockResolvedValue({ data: { created: [{ purchase_order_id: "po-new" }], already_linked: [] }, error: null });
});

import PurchaseNeedsList from "../PurchaseNeedsList";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PurchaseNeedsList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PurchaseNeedsList", () => {
  it("renders needs and status badges", async () => {
    setup();
    expect(await screen.findByText("Madeira")).toBeInTheDocument();
    expect(screen.getByText("Parafuso")).toBeInTheDocument();
    expect(screen.getByText("MO MO-001")).toBeInTheDocument();
    expect(screen.getByText("Venda SO-001")).toBeInTheDocument();
    expect(screen.getByText("PO-001")).toBeInTheDocument();
  });

  it("supports search filtering by product", async () => {
    setup();
    await screen.findByText("Madeira");
    const search = screen.getByPlaceholderText(/Buscar produto/);
    fireEvent.change(search, { target: { value: "Parafuso" } });
    await waitFor(() => expect(screen.queryByText("Madeira")).not.toBeInTheDocument());
    expect(screen.getByText("Parafuso")).toBeInTheDocument();
  });

  it("opens convert dialog and calls purchase_needs_create_po RPC", async () => {
    setup();
    await screen.findByText("Madeira");
    const createBtns = screen.getAllByRole("button", { name: /Criar Pedido/i });
    fireEvent.click(createBtns[0]);
    expect(await screen.findByText(/Confirmar e Criar/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Confirmar e Criar/));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("purchase_needs_create_po", expect.objectContaining({ _need_ids: ["n1"] })));
  });

  it("disables Criar Pedido for terminal-state needs", async () => {
    setup();
    await screen.findByText("Parafuso");
    // For n2 (po_created), the Criar Pedido button must be disabled.
    const btns = screen.getAllByRole("button", { name: /Criar Pedido/i });
    // First row (Madeira pending) enabled; second row (Parafuso po_created) disabled.
    expect(btns[0]).not.toBeDisabled();
    expect(btns[1]).toBeDisabled();
  });

  it("calls cancel_purchase_need RPC via confirm dialog", async () => {
    setup();
    await screen.findByText("Madeira");
    const cancelBtns = screen.getAllByRole("button", { name: /Cancelar/i });
    fireEvent.click(cancelBtns[0]);
    const confirm = await screen.findByText(/Cancelar necessidade/);
    expect(confirm).toBeInTheDocument();
    // Click the confirm button (the destructive one in the dialog).
    const confirmBtn = screen.getAllByRole("button").find((b) => /Confirmar|Cancelar necessidade/.test(b.textContent ?? ""));
    if (confirmBtn) fireEvent.click(confirmBtn);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("cancel_purchase_need", { _id: "n1" }));
  });
});
