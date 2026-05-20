import { describe, it, expect } from "vitest";
import { inferEntityContextFromPath } from "../inferEntityContext";

describe("inferEntityContextFromPath", () => {
  const UID = "11111111-2222-3333-4444-555555555555";

  it("matches sale order route", () => {
    expect(inferEntityContextFromPath(`/sales/orders/${UID}`)).toEqual({
      entityType: "sale_order",
      entityId: UID,
      label: "Pedido",
    });
  });

  it("matches sale quotation route", () => {
    const c = inferEntityContextFromPath(`/sales/quotations/${UID}`);
    expect(c?.entityType).toBe("sale_order");
  });

  it("matches manufacturing order", () => {
    const c = inferEntityContextFromPath(`/manufacturing/orders/${UID}`);
    expect(c?.entityType).toBe("manufacturing_order");
  });

  it("matches helpdesk tickets", () => {
    const c = inferEntityContextFromPath(`/helpdesk/tickets/${UID}`);
    expect(c?.entityType).toBe("customer_ticket");
  });

  it("returns null for unmapped paths", () => {
    expect(inferEntityContextFromPath("/dashboard")).toBeNull();
    expect(inferEntityContextFromPath("/sales/orders/not-a-uuid")).toBeNull();
  });
});
