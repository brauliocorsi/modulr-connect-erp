import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

import { useRpcMutation } from "../hooks/useRpcMutation";

function wrapper(qc: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  rpcMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("useRpcMutation", () => {
  it("calls rpc and shows success toast + invalidates keys", async () => {
    rpcMock.mockResolvedValue({ data: "ok", error: null });
    const qc = new QueryClient();
    const invSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(
      () => useRpcMutation({ rpc: "my_rpc", successMessage: "Feito!", invalidateKeys: [["x"]] }),
      { wrapper: wrapper(qc) },
    );
    await act(async () => { await result.current.mutateAsync({ _id: "1" }); });
    expect(rpcMock).toHaveBeenCalledWith("my_rpc", { _id: "1" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Feito!"));
    expect(invSpy).toHaveBeenCalledWith({ queryKey: ["x"] });
  });

  it("shows error toast on rpc error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "explosão" } });
    const qc = new QueryClient();
    const { result } = renderHook(
      () => useRpcMutation({ rpc: "my_rpc" }),
      { wrapper: wrapper(qc) },
    );
    await act(async () => {
      try { await result.current.mutateAsync({}); } catch { /* expected */ }
    });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("explosão"));
  });

  it("isPending prevents reading stale state", async () => {
    let resolveRpc: (v: { data: unknown; error: null }) => void = () => {};
    rpcMock.mockImplementation(() => new Promise((res) => { resolveRpc = res; }));
    const qc = new QueryClient();
    const { result } = renderHook(
      () => useRpcMutation({ rpc: "slow" }),
      { wrapper: wrapper(qc) },
    );
    act(() => { result.current.mutate({}); });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    await act(async () => { resolveRpc({ data: null, error: null }); });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});
