import { describe, it, expect } from "vitest";
import { resolveRouteCapacityStatus } from "../deliverySchedule";

describe("resolveRouteCapacityStatus", () => {
  it("returns unknown for null route", () => {
    expect(resolveRouteCapacityStatus(null).status).toBe("unknown");
  });

  it("returns unknown when no capacity defined at all", () => {
    expect(
      resolveRouteCapacityStatus({ cap_deliveries: null, current_deliveries: null, cap_volume_m3: null, current_volume_m3: null }).status
    ).toBe("unknown");
  });

  it("classifies available when ratio below 0.85", () => {
    expect(resolveRouteCapacityStatus({ cap_deliveries: 10, current_deliveries: 4 } as any).status).toBe("available");
  });

  it("classifies tight at >=0.85 and <1", () => {
    expect(resolveRouteCapacityStatus({ cap_deliveries: 10, current_deliveries: 9 } as any).status).toBe("tight");
  });

  it("classifies saturated at >=1", () => {
    expect(resolveRouteCapacityStatus({ cap_deliveries: 10, current_deliveries: 10 } as any).status).toBe("saturated");
    expect(resolveRouteCapacityStatus({ cap_deliveries: 10, current_deliveries: 12 } as any).status).toBe("saturated");
  });

  it("falls back to volume when no slot capacity", () => {
    const r = resolveRouteCapacityStatus({ cap_deliveries: null, current_deliveries: null, cap_volume_m3: 10, current_volume_m3: 9 } as any);
    expect(r.status).toBe("tight");
  });

  it("treats zero current as available", () => {
    expect(resolveRouteCapacityStatus({ cap_deliveries: 8, current_deliveries: 0 } as any).status).toBe("available");
  });
});
