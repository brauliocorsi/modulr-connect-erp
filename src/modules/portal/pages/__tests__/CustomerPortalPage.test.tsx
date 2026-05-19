import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: any[]) => rpcMock(...a) },
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

import CustomerPortalPage from "../pages/CustomerPortalPage";

function renderPortal(token = "tok-valid") {
  return render(
    <MemoryRouter initialEntries={[`/portal/${token}`]}>
      <Routes>
        <Route path="/portal/:token" element={<CustomerPortalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const VALID_TOKEN = {
  ok: true, customer_id: "c1", sale_order_id: "so1",
  service_case_id: null, scope: null, expires_at: null,
};
const ORDER = {
  ok: true,
  order_number: "SO-9000",
  customer_name: "Maria Cliente",
  products: [{ description: "Sofá X", quantity: 1 }],
  public_status: "in_production",
  estimated_ready_date: null,
  delivery_status: "Agendada",
  payment_status: "Pago parcialmente",
  service_cases: [{ case_number: "SC-1", status: "Em análise" }],
};

beforeEach(() => {
  rpcMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("CustomerPortalPage", () => {
  it("valid token shows public order status", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "customer_portal_validate_token") return Promise.resolve({ data: VALID_TOKEN, error: null });
      if (name === "customer_portal_order_status") return Promise.resolve({ data: ORDER, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    renderPortal();
    expect(await screen.findByText("SO-9000")).toBeInTheDocument();
    expect(screen.getByText("Maria Cliente")).toBeInTheDocument();
    expect(screen.getByText("Sofá X")).toBeInTheDocument();
    expect(screen.getByText(/Pago parcialmente/)).toBeInTheDocument();
    expect(screen.getByText("SC-1")).toBeInTheDocument();
    // sensitive internal data must not leak
    expect(screen.queryByText(/custo/i)).toBeNull();
    expect(screen.queryByText(/stock/i)).toBeNull();
    expect(screen.queryByText(/interno/i)).toBeNull();
  });

  it("invalid token shows error state", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "customer_portal_validate_token") return Promise.resolve({ data: { ok: false, error: "Token expirado" }, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    renderPortal("expired");
    expect(await screen.findByText(/Acesso inválido/)).toBeInTheDocument();
    expect(screen.getByText("Token expirado")).toBeInTheDocument();
  });

  it("customer can create a ticket via customer_ticket_create", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "customer_portal_validate_token") return Promise.resolve({ data: VALID_TOKEN, error: null });
      if (name === "customer_portal_order_status") return Promise.resolve({ data: ORDER, error: null });
      if (name === "customer_ticket_create") return Promise.resolve({ data: "new-ticket", error: null });
      return Promise.resolve({ data: null, error: null });
    });
    renderPortal();
    fireEvent.click(await screen.findByRole("button", { name: /Abrir pedido/ }));
    fireEvent.change(screen.getByLabelText(/Assunto/i) ?? screen.getAllByRole("textbox")[0], { target: { value: "Problema" } });
    const textareas = screen.getAllByRole("textbox");
    fireEvent.change(textareas[textareas.length - 1], { target: { value: "Detalhes do problema" } });
    fireEvent.click(screen.getByRole("button", { name: /^Enviar$/ }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("customer_ticket_create", expect.objectContaining({
        _token: "tok-valid",
        _payload: expect.objectContaining({ subject: "Problema", description: "Detalhes do problema", priority: "normal" }),
      })),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("customer can add a follow-up message via customer_ticket_add_message", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "customer_portal_validate_token") return Promise.resolve({ data: VALID_TOKEN, error: null });
      if (name === "customer_portal_order_status") return Promise.resolve({ data: ORDER, error: null });
      if (name === "customer_ticket_create") return Promise.resolve({ data: "new-ticket", error: null });
      if (name === "customer_ticket_add_message") return Promise.resolve({ data: "msg-id", error: null });
      return Promise.resolve({ data: null, error: null });
    });
    renderPortal();
    fireEvent.click(await screen.findByRole("button", { name: /Abrir pedido/ }));
    const textareas = screen.getAllByRole("textbox");
    fireEvent.change(textareas[0], { target: { value: "Assunto" } });
    fireEvent.change(textareas[textareas.length - 1], { target: { value: "Detalhes" } });
    fireEvent.click(screen.getByRole("button", { name: /^Enviar$/ }));
    const followup = await screen.findByPlaceholderText("", { exact: false }).catch(() => null);
    // After ticket creation, follow-up area appears
    await waitFor(() => expect(screen.getByText(/Adicionar mensagem/)).toBeInTheDocument());
    const allTextareas = screen.getAllByRole("textbox");
    fireEvent.change(allTextareas[allTextareas.length - 1], { target: { value: "mais info" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar mensagem/ }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("customer_ticket_add_message", {
        _token: "tok-valid", _ticket_id: "new-ticket", _message: "mais info",
      }),
    );
  });

  it("loading state shows initial spinner text", async () => {
    rpcMock.mockImplementation(() => new Promise(() => {})); // never resolves
    renderPortal();
    expect(await screen.findByText(/A validar acesso/)).toBeInTheDocument();
  });
});
