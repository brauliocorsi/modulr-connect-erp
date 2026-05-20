import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

const creditRow = {
  id: "c1",
  amount: 100,
  remaining_amount: 60,
  state: "open",
  reason: "avaria",
  origin_payment_id: null,
  origin_service_case_id: null,
  created_at: "2026-05-20T00:00:00Z",
};

const exhaustedRow = { ...creditRow, id: "c2", remaining_amount: 0, state: "consumed" };

function makeQuery(table: string) {
  const q: Record<string, unknown> = {
    then: (onF: (v: unknown) => unknown) =>
      Promise.resolve({
        data: table === "customer_credits" ? [creditRow, exhaustedRow] : [],
        error: null,
      }).then(onF),
  };
  ["select", "eq", "in", "order", "limit"].forEach((m) => { q[m] = vi.fn(() => q); });
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => makeQuery(t),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { CustomerCreditsPanel } from "@/modules/finance/components/CustomerCreditsPanel";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CustomerCreditsPanel partnerId="p1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("CustomerCreditsPanel", () => {
  it("renderiza créditos do cliente", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("avaria")).toBeInTheDocument());
  });

  it("create chama create_customer_credit", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /novo crédito/i }));
    const dialog = await screen.findByRole("dialog");
    const amount = dialog.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /criar crédito/i }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("create_customer_credit", expect.objectContaining({ _partner_id: "p1", _amount: 50 })));
  });

  it("apply chama apply_customer_credit", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    renderPanel();
    const applyBtns = await screen.findAllByRole("button", { name: /aplicar/i });
    // Primeiro aplicar pertence ao crédito aberto
    fireEvent.click(applyBtns[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(dialog.querySelector('button[type="button"][class*="bg-primary"]') ?? screen.getAllByRole("button", { name: /aplicar/i }).pop()!);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("apply_customer_credit", expect.objectContaining({ _credit_id: "c1" })));
  });

  it("botão aplicar fica disabled em crédito consumed", async () => {
    renderPanel();
    const btns = await screen.findAllByRole("button", { name: /^aplicar$/i });
    // Segundo botão = exhausted
    expect(btns[1]).toBeDisabled();
  });

  it("erro de backend mostra toast", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "overapply" } });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /novo crédito/i }));
    const dialog = await screen.findByRole("dialog");
    const amount = dialog.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /criar crédito/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("overapply"));
  });
});
