import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { callRouteRpc, translateError } from "../routeRpc";

// Mock supabase client + sonner
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const rpc = (supabase as any).rpc as ReturnType<typeof vi.fn>;

describe("UI-4 routeRpc lib", () => {
  beforeEach(() => {
    rpc.mockReset();
    (toast.error as any).mockReset();
    (toast.success as any).mockReset();
  });

  it("[T1] returns ok and shows success toast on { ok:true }", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const r = await callRouteRpc("delivery_route_start", { _route_id: "x" }, "Iniciar");
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("delivery_route_start", { _route_id: "x" });
    expect(toast.success).toHaveBeenCalled();
  });

  it("[T2] translates close error vehicle_not_empty to PT message", async () => {
    rpc.mockResolvedValueOnce({
      data: { ok: false, error: "vehicle_not_empty", packages: 3 },
      error: null,
    });
    const r = await callRouteRpc("delivery_route_close", { _route_id: "x" }, "Fechar rota", {
      closeContext: true,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/3 package/);
    expect(toast.error).toHaveBeenCalled();
  });

  it("[T3] translateError maps all documented close codes", () => {
    expect(translateError("close", { error: "vehicle_not_empty", packages: 2 })).toMatch(/2/);
    expect(translateError("close", { error: "orders_open", open: 1 })).toMatch(/1/);
    expect(translateError("close", { error: "manifests_unverified", count: 4 })).toMatch(/4/);
  });

  it("[T4] generic mapping for package_not_in_vehicle", () => {
    expect(translateError("generic", { error: "package_not_in_vehicle" })).toMatch(/viatura/);
  });
});

describe("UI-4 RPC contract — RouteDetail uses official RPCs only", () => {
  it("[T5] RouteDetail does not call .update/.delete/.insert on protected tables", () => {
    const out = execSync(
      `grep -rEn "from\\(['\\\"](delivery_routes|delivery_route_orders|dock_transfers|vehicle_route_manifest|stock_packages|stock_moves)['\\\"]\\)\\s*\\.\\s*(update|delete|insert|upsert)" src/modules/routes || true`
    ).toString();
    expect(out.trim()).toBe("");
  });

  it("[T6] RouteDetail wiring references the expected RPC names", () => {
    const src = execSync("cat src/modules/routes/pages/RouteDetail.tsx").toString();
    const expected = [
      "delivery_route_capacity",
      "delivery_route_change_vehicle",
      "delivery_pick_to_dock",
      "delivery_load_vehicle",
      "delivery_verify_load",
      "delivery_route_start",
      "delivery_route_complete",
      "delivery_route_close",
      "delivery_order_fail",
    ];
    for (const fn of expected) expect(src).toContain(fn);
  });

  it("[T7] DeliverOrderDialog calls delivery_order_deliver", () => {
    const src = execSync("cat src/modules/routes/components/DeliverOrderDialog.tsx").toString();
    expect(src).toContain("delivery_order_deliver");
  });

  it("[T8] ReturnPackageDialog calls delivery_return_to_warehouse", () => {
    const src = execSync("cat src/modules/routes/components/ReturnPackageDialog.tsx").toString();
    expect(src).toContain("delivery_return_to_warehouse");
  });

  it("[T9] ReturnPackageDialog shows WH/RETURN/<COND> in result string", () => {
    const src = execSync("cat src/modules/routes/components/ReturnPackageDialog.tsx").toString();
    expect(src).toContain("WH/RETURN/");
  });
});
