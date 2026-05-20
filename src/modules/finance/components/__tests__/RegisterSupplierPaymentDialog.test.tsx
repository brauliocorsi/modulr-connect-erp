import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpcMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { RegisterSupplierPaymentDialog } from "@/modules/finance/components/RegisterSupplierPaymentDialog";

beforeEach(() => {
  rpcMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("RegisterSupplierPaymentDialog", () => {
  it("chama supplier_payment_register com bill_id, amount e idempotency_key", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    render(
      <RegisterSupplierPaymentDialog
        open
        onOpenChange={() => {}}
        billId="bill-1"
        defaultAmount={250}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /registar/i }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "supplier_payment_register",
        expect.objectContaining({
          _bill_id: "bill-1",
          _amount: 250,
          _idempotency_key: expect.stringMatching(/^bill-1:/),
        }),
      ),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("não chama RPC se valor for inválido", async () => {
    render(<RegisterSupplierPaymentDialog open onOpenChange={() => {}} billId="bill-1" defaultAmount={0} />);
    fireEvent.click(screen.getByRole("button", { name: /registar/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Valor inválido"));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("mostra erro de backend", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "bill_paid" } });
    render(<RegisterSupplierPaymentDialog open onOpenChange={() => {}} billId="b" defaultAmount={10} />);
    fireEvent.click(screen.getByRole("button", { name: /registar/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("bill_paid"));
  });
});
