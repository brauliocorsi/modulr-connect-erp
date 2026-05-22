import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const sample = [
  { id: "b1", name: "BILL/001", bill_date: "2026-05-01", due_date: "2025-12-01",
    amount_total: 300, amount_paid: 100, state: "partial",
    partner_id: "p1", purchase_order_id: "po1" },
  { id: "b2", name: "BILL/002", bill_date: "2026-05-10", due_date: "2027-01-01",
    amount_total: 500, amount_paid: 0, state: "posted",
    partner_id: "p2", purchase_order_id: null },
];

const partnerSample = [{ id: "p1", name: "Fornecedor A" }, { id: "p2", name: "Fornecedor B" }];
const poSample = [{ id: "po1", name: "PO/001" }];

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn(() => Promise.resolve({ error: null })) }));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (rows: any[]) => {
    const builder: any = {
      select: () => builder,
      order: () => builder,
      limit: () => Promise.resolve({ data: rows, error: null }),
      in: (_column: string, ids: string[]) => Promise.resolve({ data: rows.filter((r) => ids.includes(r.id)), error: null }),
    };
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => makeBuilder(table === "partners" ? partnerSample : table === "purchase_orders" ? poSample : sample),
      rpc: rpcMock,
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
    },
  };
});

vi.mock("@/modules/finance/components/RegisterSupplierPaymentDialog", () => ({
  RegisterSupplierPaymentDialog: ({ open }: any) => open ? <div data-testid="register-supplier-payment-dialog" /> : null,
}));

import PayablesList from "@/modules/finance/pages/PayablesList";

const renderPage = () => render(<MemoryRouter><PayablesList /></MemoryRouter>);

describe("PayablesList (F23-D1)", () => {
  beforeEach(() => { rpcMock.mockClear(); });

  it("renderiza faturas e saldo", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("BILL/001")).toBeInTheDocument());
    expect(screen.getByText("BILL/002")).toBeInTheDocument();
    expect(screen.getByText("Fornecedor A")).toBeInTheDocument();
  });

  it("mostra badge Vencida em fatura vencida", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Vencida")).toBeInTheDocument());
  });

  it("abre dialog de pagamento", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("BILL/001")).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle("Pagar")[0]);
    expect(await screen.findByTestId("register-supplier-payment-dialog")).toBeInTheDocument();
  });

  it("cancela fatura via RPC supplier_bill_cancel", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("BILL/001")).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle("Cancelar fatura")[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Cancelar fatura/i }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("supplier_bill_cancel", expect.objectContaining({ _bill_id: "b1" }));
    });
  });

  it("mostra summary cards", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Faturas")).toBeInTheDocument());
  });
});
