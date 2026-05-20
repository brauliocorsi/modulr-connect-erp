import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const rpcMock = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/core/permissions/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: true, can: () => true, inGroup: () => true, loading: false, groups: ["system_admin"] }),
}));
vi.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-admin" } }),
}));

const METHODS = [
  { id: "m-cash", name: "Dinheiro", confirmation_mode: null, requires_reference: false, feeds_cash_session: true, default_journal_id: "j1" },
];

vi.mock("@/integrations/supabase/client", () => {
  const chain = (data: any) => ({
    select: () => chain(data),
    eq: () => chain(data),
    neq: () => chain(data),
    order: () => Promise.resolve({ data, error: null }),
    maybeSingle: () => Promise.resolve({ data, error: null }),
  });
  return {
    supabase: {
      from: (t: string) => {
        if (t === "payment_methods") return chain(METHODS);
        if (t === "sale_orders") return chain({ amount_total: 100 });
        if (t === "customer_payments") return chain([]);
        return chain(null);
      },
      rpc: (...args: unknown[]) => rpcMock(...args),
    },
  };
});

import { RegisterPaymentDialog } from "@/modules/finance/components/RegisterPaymentDialog";

function wrap(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("RegisterPaymentDialog admin CTAs (F24-D1)", () => {
  it("mostra CTA 'Configurar loja do utilizador' quando admin e user_without_store", async () => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: { status: "no_store", sessions: [] }, error: null });
    wrap(<RegisterPaymentDialog open onOpenChange={() => {}} orderId="o1" defaultAmount={10} />);
    await waitFor(() => expect(screen.getByTestId("cta-configure-store")).toBeTruthy());
    expect(screen.getByTestId("cta-configure-store").getAttribute("href")).toContain("/settings/users/u-admin");
  });

  it("mostra CTA 'Abrir caixa' quando admin e no_open_cash_session_for_store", async () => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: { status: "no_open_session", sessions: [] }, error: null });
    wrap(<RegisterPaymentDialog open onOpenChange={() => {}} orderId="o1" defaultAmount={10} />);
    await waitFor(() => expect(screen.getByTestId("cta-open-cash")).toBeTruthy());
    expect(screen.getByTestId("cta-open-cash").getAttribute("href")).toBe("/cashbox");
  });
});
