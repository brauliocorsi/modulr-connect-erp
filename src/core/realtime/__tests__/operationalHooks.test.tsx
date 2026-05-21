import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  usePaymentsRealtime,
  useRouteRealtime,
  useManufacturingRealtime,
  useIndicatorsRealtime,
  usePickingRealtime,
} from "../operationalHooks";

const onSpy = vi.fn();
const subscribeSpy = vi.fn();
const removeSpy = vi.fn();
const channelSpy = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {
    on: (...args: any[]) => { onSpy(...args); return chain; },
    subscribe: (...args: any[]) => { subscribeSpy(...args); return chain; },
  };
  return {
    supabase: {
      channel: (name: string) => { channelSpy(name); return chain; },
      removeChannel: (...args: any[]) => removeSpy(...args),
    },
  };
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ui: <QueryClientProvider client={qc}>{ui}</QueryClientProvider> };
}

function Harness({ hook }: { hook: () => void }) {
  hook();
  return null;
}

beforeEach(() => {
  onSpy.mockClear();
  subscribeSpy.mockClear();
  removeSpy.mockClear();
  channelSpy.mockClear();
});

describe("F26-B operationalHooks", () => {
  it("usePaymentsRealtime subscribes to expected tables and fires onChange debounced", async () => {
    const onChange = vi.fn();
    const { ui } = wrap(<Harness hook={() => usePaymentsRealtime({ onChange })} />);
    const { unmount } = render(ui);
    expect(channelSpy).toHaveBeenCalledWith("payments-page");
    const tables = onSpy.mock.calls.map((c) => c[1].table);
    expect(tables).toEqual(
      expect.arrayContaining(["customer_payments", "cash_movements", "cash_sessions", "bank_reconciliation_lines", "supplier_payments"]),
    );
    const cb = onSpy.mock.calls[0][2] as (p: any) => void;
    await act(async () => {
      cb({}); cb({}); cb({});
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    unmount();
    expect(removeSpy).toHaveBeenCalled();
  });

  it("useRouteRealtime is disabled without routeId and enabled with it", () => {
    const { ui: ui1 } = wrap(<Harness hook={() => useRouteRealtime({ routeId: null })} />);
    render(ui1);
    expect(channelSpy).not.toHaveBeenCalled();
    const { ui: ui2 } = wrap(<Harness hook={() => useRouteRealtime({ routeId: "r1" })} />);
    render(ui2);
    expect(channelSpy).toHaveBeenCalledWith("route-detail-r1");
  });

  it("useManufacturingRealtime invalidates expected query keys on event", async () => {
    const { qc, ui } = wrap(<Harness hook={() => useManufacturingRealtime({ moId: "m1" })} />);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    render(ui);
    const cb = onSpy.mock.calls[0][2] as (p: any) => void;
    await act(async () => { cb({}); await new Promise((r) => setTimeout(r, 500)); });
    const calls = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(calls).toEqual(expect.arrayContaining([
      JSON.stringify(["manufacturing_order", "m1"]),
      JSON.stringify(["mo-comps", "m1"]),
      JSON.stringify(["mo-ops", "m1"]),
      JSON.stringify(["purchase_needs"]),
    ]));
  });

  it("useIndicatorsRealtime invalidates the ['indicator'] prefix with high debounce", async () => {
    const { qc, ui } = wrap(<Harness hook={() => useIndicatorsRealtime()} />);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    render(ui);
    const cb = onSpy.mock.calls[0][2] as (p: any) => void;
    await act(async () => {
      cb({}); cb({}); cb({});
      await new Promise((r) => setTimeout(r, 2700));
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["indicator"] });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("usePickingRealtime scopes stock_moves filter by picking id", () => {
    const { ui } = wrap(<Harness hook={() => usePickingRealtime({ pickingId: "p1", onChange: () => {} })} />);
    render(ui);
    const movesCall = onSpy.mock.calls.find((c) => c[1].table === "stock_moves");
    expect(movesCall?.[1].filter).toBe("picking_id=eq.p1");
    expect(channelSpy).toHaveBeenCalledWith("picking-scan-p1");
  });
});
