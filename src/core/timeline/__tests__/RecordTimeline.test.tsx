import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const rpcMock = vi.fn();
const fromMock = vi.fn();
const channelMock = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: any[]) => rpcMock(...a),
    from: (...a: any[]) => fromMock(...a),
    channel: () => channelMock,
    removeChannel: vi.fn(),
  },
}));

import { RecordTimeline } from "../RecordTimeline";

const EVENTS = [
  { id: "e1", entity_type: "sale_order", entity_id: "so-1", event_type: "sale_order_invoiced", message: "Faturado", metadata: { invoice: "INV-1" }, visibility: "internal", actor_id: null, created_at: new Date(Date.now() - 60000).toISOString() },
  { id: "e2", entity_type: "sale_order", entity_id: "so-1", event_type: "sale_order_services_updated", message: null, metadata: {}, visibility: "customer_visible", actor_id: null, created_at: new Date().toISOString() },
];

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe("RecordTimeline", () => {
  it("calls activity_list_for_entity with entity refs", async () => {
    rpcMock.mockResolvedValue({ data: EVENTS, error: null });
    render(<RecordTimeline entityType="sale_order" entityId="so-1" />);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("activity_list_for_entity", {
        _entity_type: "sale_order",
        _entity_id: "so-1",
        _include_customer_visible: false,
      }),
    );
  });

  it("renders events with labels, visibility and metadata", async () => {
    rpcMock.mockResolvedValue({ data: EVENTS, error: null });
    render(<RecordTimeline entityType="sale_order" entityId="so-1" includeCustomerVisible />);
    expect(await screen.findByText("Faturado")).toBeInTheDocument();
    expect(screen.getByText("Serviços atualizados")).toBeInTheDocument();
    expect(screen.getByText(/público/)).toBeInTheDocument();
    expect(screen.getByText(/interno/)).toBeInTheDocument();
    expect(screen.getByText(/INV-1/)).toBeInTheDocument();
  });

  it("shows loading then empty state", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    render(<RecordTimeline entityType="sale_order" entityId="so-1" />);
    expect(screen.getByText(/A carregar/)).toBeInTheDocument();
    expect(await screen.findByText(/Sem eventos/)).toBeInTheDocument();
  });

  it("shows error state", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "fail" } });
    render(<RecordTimeline entityType="sale_order" entityId="so-1" />);
    expect(await screen.findByText("fail")).toBeInTheDocument();
  });

  it("never writes directly to activity_events", async () => {
    rpcMock.mockResolvedValue({ data: EVENTS, error: null });
    render(<RecordTimeline entityType="sale_order" entityId="so-1" />);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(fromMock).not.toHaveBeenCalledWith("activity_events");
  });
});
