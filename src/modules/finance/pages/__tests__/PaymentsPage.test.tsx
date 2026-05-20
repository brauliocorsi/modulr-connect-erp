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
      is: () => b,
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

describe("PaymentsPage (F24-B) — caixa físico / pendentes / conciliação bancária", () => {
  it("renderiza as três abas separadas", async () => {
    render(<MemoryRouter><PaymentsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Caixa físico/i)).toBeInTheDocument());
    expect(screen.getByText(/Pagamentos pendentes/i)).toBeInTheDocument();
    expect(screen.getByText(/Conciliação bancária/i)).toBeInTheDocument();
  });
});
