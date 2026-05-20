import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

const costRow = {
  id: "x1", kind: "internal_labor", description: "Reparação", quantity: 2, unit_cost: 25, total_cost: 50,
  supplier_id: null, created_at: "2026-05-20T00:00:00Z",
};

function makeQuery(table: string) {
  const q: Record<string, unknown> = {
    then: (onF: (v: unknown) => unknown) =>
      Promise.resolve({
        data: table === "service_case_costs" ? [costRow] : [],
        error: null,
      }).then(onF),
  };
  ["select", "eq", "order"].forEach((m) => { q[m] = vi.fn(() => q); });
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => makeQuery(t),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { ServiceCaseFinancialPanel } from "@/modules/service/components/ServiceCaseFinancialPanel";

function renderPanel(props: Partial<React.ComponentProps<typeof ServiceCaseFinancialPanel>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ServiceCaseFinancialPanel serviceCaseId="sc1" customerId="cust1" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("ServiceCaseFinancialPanel", () => {
  it("renderiza custos existentes", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText("Reparação")).toBeInTheDocument());
  });

  it("add cost chama service_case_cost_add", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /adicionar custo/i }));
    const dialog = await screen.findByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "Peça" } }); // description
    fireEvent.click(screen.getByRole("button", { name: /^adicionar$/i }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "service_case_cost_add",
        expect.objectContaining({ _service_case_id: "sc1", _description: "Peça" }),
      ),
    );
  });

  it("add charge chama service_case_charge_add", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /adicionar cobrança/i }));
    const dialog = await screen.findByRole("dialog");
    const amount = dialog.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: /^adicionar$/i }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "service_case_charge_add",
        expect.objectContaining({ _service_case_id: "sc1", _partner_id: "cust1", _amount: 75 }),
      ),
    );
  });

  it("garantia bloqueia botão de cobrança", async () => {
    renderPanel({ warrantyStatus: "in_warranty" });
    const btn = await screen.findByRole("button", { name: /adicionar cobrança/i });
    expect(btn).toBeDisabled();
  });
});
