import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(() => Promise.resolve({ data: { ok: true }, error: null })),
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (): any => {
    const thenable = Promise.resolve({ data: [], error: null });
    const b: any = {
      select: () => b,
      in: () => b,
      neq: () => b,
      eq: () => b,
      limit: () => b,
      order: () => b,
      then: thenable.then.bind(thenable),
    };
    return b;
  };
  return {
    supabase: {
      from: () => makeBuilder(),
      rpc: rpcMock,
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    },
  };
});

import PaymentsPage from "@/modules/finance/pages/PaymentsPage";

describe("PaymentsPage reconcile (F23-D2)", () => {
  it("renderiza com tab de conciliação (writes diretos eliminados — verificado por grep)", async () => {
    render(<MemoryRouter><PaymentsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Conciliação de caixa/i)).toBeInTheDocument());
  });
});
