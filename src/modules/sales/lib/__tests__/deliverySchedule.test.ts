import { describe, it, expect } from "vitest";
import { calculateDayCapacity, suggestDeliveryDays, type RouteRow, type ScheduleRow, type SaleOrderRow } from "../deliverySchedule";

const zone = (id: string, name: string, zip_from: string, zip_to: string) => ({ id, name, color: "#000", zip_from, zip_to });

const route = (over: Partial<RouteRow> = {}): RouteRow => ({
  id: "r1",
  route_date: "2026-06-01",
  state: "planned",
  zone_id: "z1",
  delivery_zones: zone("z1", "Norte", "4000", "4099"),
  cap_deliveries: 10,
  cap_volume_m3: 12,
  cap_assembly_minutes: 240,
  current_deliveries: 0,
  current_volume_m3: 0,
  current_assembly_minutes: 0,
  ...over,
});

const sched = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: "s1", sale_order_id: "so1", route_id: "r1", scheduled_date: "2026-06-01", status: "scheduled", ...over,
});

describe("calculateDayCapacity", () => {
  it("counts slots used", () => {
    const c = calculateDayCapacity("2026-06-01", [route()], [sched(), sched({ id: "s2" }), sched({ id: "s3", status: "cancelled" })]);
    expect(c.slots_used).toBe(2);
    expect(c.slots_capacity).toBe(10);
  });

  it("computes volume from route current and capacity", () => {
    const c = calculateDayCapacity("2026-06-01", [route({ current_volume_m3: 6, cap_volume_m3: 12 })], [sched()]);
    expect(c.volume_used_m3).toBe(6);
    expect(c.volume_capacity_m3).toBe(12);
  });

  it("falls back to SO estimates when route current_volume missing", () => {
    const sos: SaleOrderRow[] = [{ id: "so1", est_volume_m3: 3 }, { id: "so2", est_volume_m3: 2 }];
    const c = calculateDayCapacity(
      "2026-06-01",
      [route({ current_volume_m3: null })],
      [sched({ sale_order_id: "so1" }), sched({ id: "s2", sale_order_id: "so2" })],
      sos
    );
    expect(c.volume_used_m3).toBe(5);
  });

  it("returns nulls when capacity absent", () => {
    const c = calculateDayCapacity("2026-06-01", [route({ cap_volume_m3: null, vehicles: null, cap_assembly_minutes: null })], [sched()]);
    expect(c.volume_capacity_m3).toBeNull();
    expect(c.assembly_minutes_capacity).toBeNull();
  });

  it("classifies saturation green/yellow/red", () => {
    const green = calculateDayCapacity("d", [route({ cap_deliveries: 10 })], [sched()]);
    expect(green.saturation_status).toBe("green");
    const yellow = calculateDayCapacity("d", [route({ cap_deliveries: 4 })], [sched(), sched({ id: "s2" }), sched({ id: "s3" })]);
    expect(yellow.saturation_status).toBe("yellow");
    const red = calculateDayCapacity("d", [route({ cap_deliveries: 2 })], [sched(), sched({ id: "s2" })]);
    expect(red.saturation_status).toBe("red");
  });
});

describe("suggestDeliveryDays", () => {
  const baseRoutes: RouteRow[] = [
    route({ id: "ra", route_date: "2026-06-03", delivery_zones: zone("z1", "Norte", "4000", "4099"), zone_id: "z1", cap_volume_m3: 12, current_volume_m3: 4 }),
    route({ id: "rb", route_date: "2026-06-02", delivery_zones: zone("z2", "Sul", "8000", "8099"), zone_id: "z2", cap_volume_m3: 12, current_volume_m3: 0 }),
    route({ id: "rc", route_date: "2026-06-05", delivery_zones: zone("z1", "Norte", "4000", "4099"), zone_id: "z1", cap_volume_m3: 12, current_volume_m3: 1 }),
  ];

  it("prioritises zone match by postal code", () => {
    const out = suggestDeliveryDays({ postalCode: "4050", fromDate: "2026-06-01", routes: baseRoutes });
    expect(out.length).toBe(2);
    expect(out.every((s) => s.zone_name === "Norte")).toBe(true);
  });

  it("ranks higher remaining capacity first", () => {
    const out = suggestDeliveryDays({ postalCode: "4050", fromDate: "2026-06-01", routes: baseRoutes });
    expect(out[0].route_id).toBe("rc"); // 11 m³ free > 8 m³ free
  });

  it("uses proximity when capacity equal", () => {
    const rs: RouteRow[] = [
      route({ id: "x1", route_date: "2026-06-10", delivery_zones: zone("z1","N","4000","4099"), zone_id:"z1", cap_volume_m3: 10, current_volume_m3: 0 }),
      route({ id: "x2", route_date: "2026-06-02", delivery_zones: zone("z1","N","4000","4099"), zone_id:"z1", cap_volume_m3: 10, current_volume_m3: 0 }),
    ];
    const out = suggestDeliveryDays({ postalCode: "4050", fromDate: "2026-06-01", routes: rs });
    expect(out[0].route_id).toBe("x2");
  });

  it("falls back to SO zone when CP has no zone", () => {
    const out = suggestDeliveryDays({ postalCode: "9999", fromDate: "2026-06-01", routes: baseRoutes, fallbackZoneId: "z2" });
    expect(out.length).toBe(1);
    expect(out[0].zone_name).toBe("Sul");
  });

  it("returns empty when no match and no fallback", () => {
    const out = suggestDeliveryDays({ postalCode: "9999", fromDate: "2026-06-01", routes: baseRoutes });
    expect(out).toEqual([]);
  });
});
