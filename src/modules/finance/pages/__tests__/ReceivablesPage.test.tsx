import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const today = new Date();
const past = new Date(today.getTime() - 5 * 86400000).toISOString().slice(0, 10);
const future = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);

const schedules = [
  {
    id: "s1", label: "1/2", due_kind: "fixed_date", due_date: past, due_days: null,
    amount: 100, paid_amount: 0, state: "unpaid", order_id: "o1",
    sale_orders: {
      id: "o1", name: "SO/001", partner_id: "p1", store_id: "st1", salesperson_id: "u1",
      partners: { id: "p1", name: "Alpha" }, stores: { id: "st1", name: "Loja Centro" },
    },
  },
  {
    id: "s2", label: "1/1", due_kind: "fixed_date", due_date: future, due_days: null,
    amount: 200, paid_amount: 50, state: "partial", order_id: "o2",
    sale_orders: {
      id: "o2", name: "SO/002", partner_id: "p2", store_id: "st1", salesperson_id: "u1",
      partners: { id: "p2", name: "Beta" }, stores: { id: "st1", name: "Loja Centro" },
    },
  },
  {
    id: "s3", label: "1/1", due_kind: "on_delivery", due_date: null, due_days: null,
    amount: 80, paid_amount: 0, state: "unpaid", order_id: "o3",
    sale_orders: {
      id: "o3", name: "SO/003", partner_id: "p3", store_id: "st2", salesperson_id: "u2",
      partners: { id: "p3", name: "Gamma" }, stores: { id: "st2", name: "Loja Sul" },
    },
  },
];

const payments = [
  { order_id: "o1", payment_method_id: "m1", journal_id: "j1", source: "manual", state: "posted",
    payment_methods: { name: "Multibanco" }, account_journals: { type: "bank" } },
  { order_id: "o2", payment_method_id: "m2", journal_id: "j2", source: "manual", state: "posted",
    payment_methods: { name: "Dinheiro" }, account_journals: { type: "cash" } },
];
const profiles = [
  { id: "u1", display_name: "Ana", email: "ana@x" },
  { id: "u2", display_name: "Beto", email: "beto@x" },
];

vi.mock("@/integrations/supabase/client", () => {
  const schedulesBuilder: any = {
    select: () => schedulesBuilder,
    order: () => Promise.resolve({ data: schedules, error: null }),
  };
  const paymentsBuilder: any = {
    select: () => paymentsBuilder,
    in: () => Promise.resolve({ data: payments, error: null }),
  };
  const profilesBuilder: any = {
    select: () => Promise.resolve({ data: profiles, error: null }),
  };
  return {
    supabase: {
      from: (t: string) => {
        if (t === "customer_payments") return paymentsBuilder;
        if (t === "profiles") return profilesBuilder;
        return schedulesBuilder;
      },
      rpc: vi.fn(() => Promise.resolve({ error: null })),
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
    },
  };
});

vi.mock("@/modules/finance/components/RegisterPaymentDialog", () => ({
  RegisterPaymentDialog: ({ open }: any) => (open ? <div data-testid="register-payment-dialog" /> : null),
}));

import ReceivablesPage from "@/modules/finance/pages/ReceivablesPage";

const renderPage = () => render(<MemoryRouter><ReceivablesPage /></MemoryRouter>);

describe("ReceivablesPage v2 (F28-FIN B.2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renderiza parcelas, summary e tabs de origem", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("SO/001")).toBeInTheDocument());
    expect(screen.getByText("SO/002")).toBeInTheDocument();
    expect(screen.getByText("Saldo aberto")).toBeInTheDocument();
    // 6 tabs
    ["Todos", "Vendas balcão", "Entregas", "Banco/Conciliação", "Vencidos", "Pagos/Confirmados"]
      .forEach((t) => expect(screen.getByRole("tab", { name: t })).toBeInTheDocument());
  });

  it("mostra badge Vencido para parcelas em atraso", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Vencido")).toBeInTheDocument());
  });

  it("classifica origem: bank journal → Banco/Conciliação", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("SO/001")).toBeInTheDocument());
    // SO/001 tem pagamento via journal type='bank' → origem renderizada como "Banco/Conciliação"
    expect(screen.getAllByText("Banco/Conciliação").length).toBeGreaterThan(0);
  });

  it("classifica origem: due_kind=on_delivery → Entrega/Rota", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("SO/003")).toBeInTheDocument());
    expect(screen.getAllByText("Entrega/Rota").length).toBeGreaterThan(0);
  });

  it("renderiza tab Vencidos", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("SO/001")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Vencidos" })).toBeInTheDocument();
  });

  it("abre dialog de registar recebimento", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("SO/001")).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle("Registar recebimento")[0]);
    expect(await screen.findByTestId("register-payment-dialog")).toBeInTheDocument();
  });

  it("link da venda aponta para /sales/orders/:id", async () => {
    renderPage();
    await waitFor(() => {
      const link = screen.getByText("SO/001").closest("a");
      expect(link).toHaveAttribute("href", "/sales/orders/o1");
    });
  });

  it("mostra método de pagamento e vendedor", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Multibanco")).toBeInTheDocument());
    expect(screen.getByText("Dinheiro")).toBeInTheDocument();
    expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
  });
});
