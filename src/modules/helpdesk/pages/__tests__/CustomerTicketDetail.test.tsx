import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn();
const fromMock = vi.fn();
const channelMock = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: any[]) => rpcMock(...a),
    from: (...a: any[]) => fromMock(...a),
    channel: () => channelMock,
    removeChannel: vi.fn(),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

// Stub heavy children
vi.mock("@/core/timeline/RecordTimeline", () => ({ RecordTimeline: () => <div data-testid="timeline" /> }));
vi.mock("@/core/tasks/RecordTasks", () => ({ RecordTasks: () => <div data-testid="tasks" /> }));
vi.mock("@/core/conversations/RecordConversations", () => ({ RecordConversations: () => <div data-testid="convs" /> }));

import CustomerTicketDetail from "../CustomerTicketDetail";

function makeTicket(over: any = {}) {
  return {
    id: "t1", ticket_number: "TK-001", customer_id: "c1", sale_order_id: "so1", service_case_id: null,
    source: "portal", category: "damaged_product", priority: "high", status: "new",
    subject: "Sofá riscado", description: "descrição",
    assigned_to: null, created_at: new Date().toISOString(),
    customer: { name: "Cliente A" }, sale_order: { name: "SO-001" }, service_case: null,
    ...over,
  };
}

function setupFrom(ticket: any, messages: any[] = []) {
  fromMock.mockImplementation((table: string) => {
    if (table === "customer_tickets") {
      const b: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: ticket, error: null }),
      };
      return b;
    }
    if (table === "customer_ticket_messages") {
      const b: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: messages, error: null }),
      };
      return b;
    }
    return {} as any;
  });
}

function renderAt(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/helpdesk/tickets/${id}`]}>
        <Routes>
          <Route path="/helpdesk/tickets/:id" element={<CustomerTicketDetail />} />
          <Route path="/service/requests/:id" element={<div>service-case-page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe("CustomerTicketDetail", () => {
  it("renders header and side panels", async () => {
    setupFrom(makeTicket());
    renderAt("t1");
    expect(await screen.findByText(/Ticket TK-001/)).toBeInTheDocument();
    expect(screen.getByText("Sofá riscado")).toBeInTheDocument();
    expect(screen.getByTestId("timeline")).toBeInTheDocument();
    expect(screen.getByTestId("tasks")).toBeInTheDocument();
    expect(screen.getByTestId("convs")).toBeInTheDocument();
  });

  it("shows service_case link when linked", async () => {
    setupFrom(makeTicket({ service_case_id: "sc1", service_case: { case_number: "SC-9" }, status: "linked_to_service_case" }));
    renderAt("t1");
    expect(await screen.findByText(/Service Case SC-9/)).toBeInTheDocument();
  });

  it("sends public message via helpdesk_ticket_add_message", async () => {
    setupFrom(makeTicket());
    renderAt("t1");
    await screen.findByText(/Ticket TK-001/);
    const ta = screen.getByPlaceholderText(/Mensagem pública/);
    fireEvent.change(ta, { target: { value: "olá cliente" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar/ }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("helpdesk_ticket_add_message", {
        _ticket_id: "t1", _message: "olá cliente", _internal: false,
      }),
    );
  });

  it("sends internal note when toggled", async () => {
    setupFrom(makeTicket());
    renderAt("t1");
    await screen.findByText(/Ticket TK-001/);
    fireEvent.click(screen.getByRole("button", { name: "Interna" }));
    const ta = screen.getByPlaceholderText(/Nota interna/);
    fireEvent.change(ta, { target: { value: "nota privada" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar/ }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("helpdesk_ticket_add_message", {
        _ticket_id: "t1", _message: "nota privada", _internal: true,
      }),
    );
  });

  it("converts to service_case for convertible categories", async () => {
    setupFrom(makeTicket({ category: "warranty_claim" }));
    rpcMock.mockImplementation((name: string) =>
      name === "helpdesk_ticket_convert_to_service_case"
        ? Promise.resolve({ data: "case-uuid", error: null })
        : Promise.resolve({ data: null, error: null }),
    );
    renderAt("t1");
    fireEvent.click(await screen.findByRole("button", { name: /Converter/ }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("helpdesk_ticket_convert_to_service_case", {
        _ticket_id: "t1", _payload: {},
      }),
    );
  });

  it("disables convert button for general_question (no force from UI)", async () => {
    setupFrom(makeTicket({ category: "general_question" }));
    renderAt("t1");
    const btn = await screen.findByRole("button", { name: /Converter/ });
    expect(btn).toBeDisabled();
  });

  it("closes ticket via helpdesk_ticket_close", async () => {
    setupFrom(makeTicket());
    renderAt("t1");
    fireEvent.click(await screen.findByRole("button", { name: /Encerrar/ }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("helpdesk_ticket_close", expect.objectContaining({ _ticket_id: "t1" })),
    );
  });
});
