import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const today = new Date();
const inFuture = new Date(today); inFuture.setDate(today.getDate() + 30);
const inPast = new Date(today); inPast.setDate(today.getDate() - 5);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const sample = [
  {
    id: "e1", name: "Renda escritório", supplier_id: "p1", category: "Renda",
    amount: 500, frequency: "monthly", next_due_date: iso(inFuture),
    payment_method_id: null, active: true, notes: null,
    cancelled_at: null, last_generated_bill_id: null,
    partners: { name: "Senhorio Lda" }, payment_methods: null,
  },
  {
    id: "e2", name: "Internet", supplier_id: "p2", category: "Internet",
    amount: 40, frequency: "monthly", next_due_date: iso(inPast),
    payment_method_id: null, active: true, notes: null,
    cancelled_at: null, last_generated_bill_id: "bill-9",
    partners: { name: "ISP" }, payment_methods: null,
  },
];

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn<any>(() => Promise.resolve({ data: { ok: true } as any, error: null })) }));

vi.mock("@/integrations/supabase/client", () => {
  const recurringBuilder: any = {
    select: () => recurringBuilder,
    order: () => recurringBuilder,
    limit: () => Promise.resolve({ data: sample, error: null }),
  };
  const otherBuilder: any = {
    select: () => otherBuilder,
    eq: () => otherBuilder,
    order: () => otherBuilder,
    limit: () => Promise.resolve({ data: [], error: null }),
    then: (cb: any) => Promise.resolve({ data: [], error: null }).then(cb),
  };
  return {
    supabase: {
      from: (t: string) => (t === "recurring_expenses" ? recurringBuilder : otherBuilder),
      rpc: rpcMock,
    },
  };
});

vi.mock("@/modules/finance/components/RecurringExpenseDialog", () => ({
  RecurringExpenseDialog: ({ open }: any) => open ? <div data-testid="expense-dialog" /> : null,
}));

import RecurringExpensesPage from "@/modules/finance/pages/RecurringExpensesPage";

const renderPage = () => render(<MemoryRouter><RecurringExpensesPage /></MemoryRouter>);

describe("RecurringExpensesPage (F23-D3)", () => {
  beforeEach(() => { rpcMock.mockClear(); });

  it("renderiza lista de despesas fixas", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Renda escritório")).toBeInTheDocument());
    expect(screen.getByText("Internet")).toBeInTheDocument();
    expect(screen.getByText("Senhorio Lda")).toBeInTheDocument();
  });

  it("mostra badge Vencida em despesa vencida", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Vencida")).toBeInTheDocument());
  });

  it("abre dialog de criação", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Renda escritório")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Nova despesa/i }));
    expect(await screen.findByTestId("expense-dialog")).toBeInTheDocument();
  });

  it("gera conta via RPC recurring_expense_generate_bill", async () => {
    rpcMock.mockResolvedValueOnce({ data: { ok: true, bill_id: "bill-1" }, error: null });
    renderPage();
    await waitFor(() => expect(screen.getByText("Renda escritório")).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle("Gerar conta agora")[0]);
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("recurring_expense_generate_bill", { _expense_id: "e1" });
    });
  });

  it("cancela despesa exige motivo e chama RPC", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Renda escritório")).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle("Cancelar despesa")[0]);
    const confirmBtn = await screen.findByRole("button", { name: /Confirmar cancelamento/i });
    expect(confirmBtn).toBeDisabled();
    const input = screen.getByPlaceholderText(/motivo/i);
    fireEvent.change(input, { target: { value: "não preciso mais" } });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("recurring_expense_cancel", expect.objectContaining({ _reason: "não preciso mais" }));
    });
  });

  it("mostra summary cards", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Ativas")).toBeInTheDocument());
    expect(screen.getByText("Equivalente mensal")).toBeInTheDocument();
  });
});
