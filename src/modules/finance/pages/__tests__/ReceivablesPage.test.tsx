import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const today = new Date();
const past = new Date(today.getTime() - 5 * 86400000).toISOString().slice(0, 10);
const future = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);

const sample = [
  { id: "s1", label: "1/2", due_kind: "fixed_date", due_date: past, due_days: null,
    amount: 100, paid_amount: 0, state: "unpaid", order_id: "o1",
    sale_orders: { id: "o1", name: "SO/001", partner_id: "p1", partners: { id: "p1", name: "Alpha" } } },
  { id: "s2", label: "1/1", due_kind: "fixed_date", due_date: future, due_days: null,
    amount: 200, paid_amount: 50, state: "partial", order_id: "o2",
    sale_orders: { id: "o2", name: "SO/002", partner_id: "p2", partners: { id: "p2", name: "Beta" } } },
];

vi.mock("@/integrations/supabase/client", () => {
  const builder: any = {
    select: () => builder,
    neq: () => builder,
    order: () => Promise.resolve({ data: sample, error: null }),
  };
  return {
    supabase: {
      from: () => builder,
      rpc: vi.fn(() => Promise.resolve({ error: null })),
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
    },
  };
});

vi.mock("@/modules/finance/components/RegisterPaymentDialog", () => ({
  RegisterPaymentDialog: ({ open }: any) => open ? <div data-testid="register-payment-dialog" /> : null,
}));

import ReceivablesPage from "@/modules/finance/pages/ReceivablesPage";

const renderPage = () => render(<MemoryRouter><ReceivablesPage /></MemoryRouter>);

describe("ReceivablesPage (F23-D1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renderiza parcelas com saldo", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("SO/001")).toBeInTheDocument());
    expect(screen.getByText("SO/002")).toBeInTheDocument();
    expect(screen.getByText(/Saldo aberto/i)).toBeInTheDocument();
  });

  it("mostra badge Vencido para parcelas em atraso", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Vencido")).toBeInTheDocument());
  });

  it("abre dialog de registar recebimento", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("SO/001")).toBeInTheDocument());
    const buttons = screen.getAllByTitle("Registar recebimento");
    fireEvent.click(buttons[0]);
    expect(await screen.findByTestId("register-payment-dialog")).toBeInTheDocument();
  });

  it("mostra summary cards com contagem", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Parcelas em aberto")).toBeInTheDocument());
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("mostra link para a venda", async () => {
    renderPage();
    await waitFor(() => {
      const link = screen.getByText("SO/001").closest("a");
      expect(link).toHaveAttribute("href", "/sales/orders/o1");
    });
  });
});
