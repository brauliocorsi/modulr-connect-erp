import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn().mockResolvedValue({ data: "ok", error: null });

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => {
  const stores = [{ id: "st1", name: "Loja Lisboa", code: "LIS" }];
  const assignments = [
    { id: "a1", store_id: "st1", role: "cashier", is_default: true, active: true, removed_reason: null, stores: { name: "Loja Lisboa", code: "LIS" } },
  ];
  const chain = (data: any) => ({
    select: () => chain(data),
    eq: () => chain(data),
    order: () => Promise.resolve({ data, error: null }),
  });
  return {
    supabase: {
      from: (t: string) => {
        if (t === "stores") return chain(stores);
        if (t === "user_store_assignments") return chain(assignments);
        return chain([]);
      },
      rpc: (...args: unknown[]) => rpcMock(...args),
    },
  };
});

import { UserStoreAssignmentsPanel } from "@/modules/settings/components/UserStoreAssignmentsPanel";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("UserStoreAssignmentsPanel", () => {
  it("lista assignments existentes com badge default", async () => {
    wrap(<UserStoreAssignmentsPanel userId="u1" />);
    await waitFor(() => expect(screen.getByText("Loja Lisboa")).toBeTruthy());
    expect(screen.getByText("Default")).toBeTruthy();
    expect(screen.getByText("cashier")).toBeTruthy();
  });

  it("chama RPC user_store_assignment_upsert ao atribuir loja", async () => {
    rpcMock.mockClear();
    wrap(<UserStoreAssignmentsPanel userId="u1" />);
    await waitFor(() => expect(screen.getByText("Loja Lisboa")).toBeTruthy());
    // Open store select
    const triggers = screen.getAllByRole("combobox");
    fireEvent.click(triggers[0]);
    await waitFor(() => expect(screen.getAllByText("Loja Lisboa").length).toBeGreaterThan(1));
    fireEvent.click(screen.getAllByText("Loja Lisboa")[1]);
    fireEvent.click(screen.getByRole("button", { name: /atribuir/i }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "user_store_assignment_upsert",
        expect.objectContaining({ _user_id: "u1", _store_id: "st1" }),
      ),
    );
  });
});
