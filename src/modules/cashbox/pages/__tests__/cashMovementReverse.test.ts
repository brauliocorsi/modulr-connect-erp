import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { supabase } from "@/integrations/supabase/client";

beforeEach(() => rpcMock.mockReset());

describe("cash_movement_reverse RPC contract", () => {
  it("invoca a RPC com movement_id e reason", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    await (supabase.rpc as any)("cash_movement_reverse", {
      _movement_id: "m1",
      _reason: "erro",
    });
    expect(rpcMock).toHaveBeenCalledWith("cash_movement_reverse", { _movement_id: "m1", _reason: "erro" });
  });
});
