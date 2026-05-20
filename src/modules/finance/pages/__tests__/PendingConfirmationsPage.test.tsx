import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const sample = [
  { id: "cp1", name: "PAY/001", payment_date: "2026-05-15", amount: 250, state: "pending",
    reference: "REF123", partner_id: "p1", order_id: "o1",
    payment_methods: { name: "Multibanco", confirmation_mode: "manual" },
    account_journals: { name: "Banco" },
    partners: { name: "Cliente X" },
    sale_orders: { name: "SO/777" } },
];

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn(() => Promise.resolve({ error: null })) }));

vi.mock("@/integrations/supabase/client", () => {
  const builder: any = {
    select: () => builder,
    in: () => builder,
    order: () => Promise.resolve({ data: sample, error: null }),
  };
  return {
    supabase: {
      from: () => builder,
      rpc: rpcMock,
    },
  };
});

import PendingConfirmationsPage from "@/modules/finance/pages/PendingConfirmationsPage";

const renderPage = () => render(<MemoryRouter><PendingConfirmationsPage /></MemoryRouter>);

describe("PendingConfirmationsPage (F23-D1)", () => {
  beforeEach(() => rpcMock.mockClear());

  it("lista pagamentos pendentes", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("PAY/001")).toBeInTheDocument());
    expect(screen.getByText("Cliente X")).toBeInTheDocument();
  });

  it("confirma via RPC confirm_pending_payment", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("PAY/001")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("Confirmar"));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("confirm_pending_payment", { _payment: "cp1" }));
  });

  it("rejeitar exige motivo", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("PAY/001")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("Rejeitar"));
    const rejectBtn = await screen.findByRole("button", { name: /^Rejeitar$/i });
    expect(rejectBtn).toBeDisabled();
  });

  it("rejeita via RPC cancel_customer_payment com motivo", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("PAY/001")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("Rejeitar"));
    const textarea = await screen.findByLabelText(/Motivo/i);
    fireEvent.change(textarea, { target: { value: "valor não recebido" } });
    fireEvent.click(screen.getByRole("button", { name: /^Rejeitar$/i }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("cancel_customer_payment", { _payment_id: "cp1", _reason: "valor não recebido" });
    });
  });
});
