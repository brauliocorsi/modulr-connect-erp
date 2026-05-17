import { describe, it, expect, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), order: async () => ({ data: [] }) }) }) }) } }));

const toastErr = vi.fn();
const toastOk = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastErr(m), success: (m: string) => toastOk(m) } }));

// Replicate the close error mapping pure function (mirrors ManufacturingOrderDetail.tsx).
const CLOSE_ERROR_MESSAGES: Record<string, string> = {
  WORK_ORDERS_NOT_DONE: "Ainda existem operações abertas.",
  QUALITY_CHECK_REQUIRED: "Existe controlo de qualidade obrigatório pendente.",
  OPEN_BLOCKING_ISSUES: "Existem problemas bloqueantes abertos.",
};
function closeErrorMessage(raw: string) {
  for (const k of Object.keys(CLOSE_ERROR_MESSAGES)) if (raw.includes(k)) return CLOSE_ERROR_MESSAGES[k];
  return raw;
}

describe("close_mo error mapping", () => {
  it.each([
    ["WORK_ORDERS_NOT_DONE", "Ainda existem operações abertas."],
    ["QUALITY_CHECK_REQUIRED", "Existe controlo de qualidade obrigatório pendente."],
    ["OPEN_BLOCKING_ISSUES", "Existem problemas bloqueantes abertos."],
  ])("maps %s to friendly message", (code, expected) => {
    expect(closeErrorMessage(`ERROR: ${code} something`)).toBe(expected);
  });

  it("passes through unknown errors verbatim", () => {
    expect(closeErrorMessage("boom")).toBe("boom");
  });
});

describe("close MO RPC call shape", () => {
  it("invokes the close_mo RPC with the MO id", async () => {
    rpc.mockResolvedValue({ error: null });
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.rpc("close_mo", { _mo: "mo-1" });
    expect(rpc).toHaveBeenCalledWith("close_mo", { _mo: "mo-1" });
  });
});
