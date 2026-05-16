import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { callM5Rpc, translateM5Error } from "../m5Rpc";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const rpc = (supabase as any).rpc as ReturnType<typeof vi.fn>;

describe("UI M5 — m5Rpc wrapper", () => {
  beforeEach(() => {
    rpc.mockReset();
    (toast.error as any).mockReset();
    (toast.success as any).mockReset();
  });

  it("[T1] callM5Rpc passes args and toasts success", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true, pickup_id: "p1" }, error: null });
    const r = await callM5Rpc("create_customer_pickup", { _sale_order_id: "s1" }, "Criar");
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("create_customer_pickup", { _sale_order_id: "s1" });
    expect(toast.success).toHaveBeenCalled();
  });

  it("[T2] translates damaged_blocks_pickup", () => {
    expect(translateM5Error({ error: "damaged_blocks_pickup" })).toMatch(/danificados/);
  });

  it("[T3] translates closure_pending", () => {
    expect(translateM5Error({ error: "closure_pending" })).toMatch(/Falta fechar/);
  });

  it("[T4] translates vehicle_not_empty with package count", () => {
    expect(translateM5Error({ error: "vehicle_not_empty", packages: 4 })).toMatch(/4 package/);
  });

  it("[T5] translates reschedule_blocked_damaged", () => {
    expect(translateM5Error({ error: "reschedule_blocked_damaged" })).toMatch(/bloqueiam/);
  });

  it("[T6] returns ok:false and shows error toast on backend ok:false", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false, error: "carrier_missing_location" }, error: null });
    const r = await callM5Rpc("delivery_handover_to_carrier", { _schedule_id: "x", _carrier_id: "c" }, "Handover");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/stock_location_id/);
    expect(toast.error).toHaveBeenCalled();
  });
});

describe("UI M5 — RPC contract (UI nunca faz update direto)", () => {
  it("[T7] PickupsPage chama apenas RPCs M5", () => {
    const src = execSync("cat src/modules/m5/pages/PickupsPage.tsx").toString();
    expect(src).toContain("create_customer_pickup");
    expect(src).toContain("delivery_pick_to_pickup_area");
    expect(src).toContain("validate_customer_pickup");
  });

  it("[T8] CarrierShipmentsPage chama apenas RPCs M5", () => {
    const src = execSync("cat src/modules/m5/pages/CarrierShipmentsPage.tsx").toString();
    expect(src).toContain("delivery_handover_to_carrier");
    expect(src).toContain("carrier_confirm_delivered");
    expect(src).toContain("carrier_mark_failed_or_returned");
  });

  it("[T9] CashClosureCard chama cash_summary e cash_close", () => {
    const src = execSync("cat src/modules/m5/components/CashClosureCard.tsx").toString();
    expect(src).toContain("delivery_route_cash_summary");
    expect(src).toContain("delivery_route_cash_close");
  });

  it("[T10] RescheduleDialog chama delivery_schedule_reschedule", () => {
    const src = execSync("cat src/modules/m5/components/RescheduleDialog.tsx").toString();
    expect(src).toContain("delivery_schedule_reschedule");
  });

  it("[T11] RouteDetail integra CashClosureCard e RescheduleDialog", () => {
    const src = execSync("cat src/modules/routes/pages/RouteDetail.tsx").toString();
    expect(src).toContain("CashClosureCard");
    expect(src).toContain("RescheduleDialog");
  });

  it("[T12] Nenhum update/insert/delete directo em tabelas críticas dentro de src/modules/m5", () => {
    const out = execSync(
      `grep -rEn "from\\(['\\\"](customer_pickups|delivery_schedules|delivery_routes|delivery_route_orders|delivery_route_cash_closure|cash_movements|customer_payments|stock_moves|stock_packages|stock_package_movements)['\\\"]\\)\\s*\\.\\s*(update|delete|insert|upsert)" src/modules/m5 || true`
    ).toString();
    expect(out.trim()).toBe("");
  });

  it("[T13] CarrierShipmentsPage mostra estado físico with_carrier", () => {
    const src = execSync("cat src/modules/m5/pages/CarrierShipmentsPage.tsx").toString();
    expect(src).toContain("with_carrier");
  });

  it("[T14] RescheduleDialog tem alerta para stock na viatura e damaged", () => {
    const src = execSync("cat src/modules/m5/components/RescheduleDialog.tsx").toString();
    expect(src).toContain("alert-on-vehicle");
    expect(src).toContain("alert-damaged");
  });

  it("[T15] CashClosureCard cobre 5 métodos (cash/mbway/multibanco/transfer/other)", () => {
    const src = execSync("cat src/modules/m5/components/CashClosureCard.tsx").toString();
    for (const k of ["actual_cash", "actual_mbway", "actual_multibanco", "actual_transfer", "actual_other"]) {
      expect(src).toContain(k);
    }
  });
});
