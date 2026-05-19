import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const TICKETS = [
  {
    id: "t1", ticket_number: "TK-001", customer_id: "c1", sale_order_id: "so1", service_case_id: null,
    source: "portal", category: "damaged_product", priority: "high", status: "new",
    subject: "Sofá danificado", assigned_to: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    customer: { name: "Cliente A" }, sale_order: { name: "SO-001" },
  },
  {
    id: "t2", ticket_number: "TK-002", customer_id: "c2", sale_order_id: null, service_case_id: "sc1",
    source: "helpdesk", category: "general_question", priority: "normal", status: "resolved",
    subject: "Dúvida", assigned_to: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    customer: { name: "Cliente B" }, sale_order: null,
  },
];

const fromMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...a: any[]) => fromMock(...a) },
}));

function makeBuilder(rows: any[]) {
  const b: any = {};
  ["select", "order", "limit", "eq", "not", "is", "or"].forEach((m) => (b[m] = vi.fn().mockReturnValue(b)));
  b.then = (resolve: any) => resolve({ data: rows, error: null });
  return b;
}

beforeEach(() => {
  fromMock.mockReset();
  fromMock.mockImplementation(() => makeBuilder(TICKETS));
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CustomerTicketsList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

import CustomerTicketsList from "../CustomerTicketsList";

describe("CustomerTicketsList", () => {
  it("renders tickets", async () => {
    setup();
    expect(await screen.findByText("TK-001")).toBeInTheDocument();
    expect(screen.getByText("TK-002")).toBeInTheDocument();
    expect(screen.getByText("Cliente A")).toBeInTheDocument();
  });

  it("supports global search via header input", async () => {
    setup();
    await screen.findByText("TK-001");
    const search = screen.getByPlaceholderText(/Buscar nº ou assunto/);
    fireEvent.change(search, { target: { value: "danificado" } });
    await waitFor(() => expect(fromMock).toHaveBeenCalledWith("customer_tickets"));
  });

  it("renders empty state when no rows", async () => {
    fromMock.mockImplementation(() => makeBuilder([]));
    setup();
    expect(await screen.findByText(/Sem tickets/)).toBeInTheDocument();
  });

  it("renders error state on rpc error", async () => {
    fromMock.mockImplementation(() => {
      const b = makeBuilder([]);
      b.then = (resolve: any) => resolve({ data: null, error: { message: "boom" } });
      return b;
    });
    setup();
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});
