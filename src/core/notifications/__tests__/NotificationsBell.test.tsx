import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
const STABLE_USER = { id: "user-1" };
vi.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: STABLE_USER }),
}));

import { NotificationsBell } from "../NotificationsBell";

const NOTIFS = [
  { id: "n1", title: "Crítico", body: "x", module: "stock", category: "alerts", severity: "critical", status: "unread", recipient_group: null, user_id: "user-1", read_at: null, created_at: new Date().toISOString() },
  { id: "n2", title: "Atenção", body: "y", module: "sales", category: "billing", severity: "warning", status: "unread", recipient_group: "finance", user_id: null, read_at: null, created_at: new Date().toISOString() },
  { id: "n3", title: "Info", body: "z", module: null, category: "general", severity: "info", status: "read", recipient_group: null, user_id: "user-1", read_at: new Date().toISOString(), created_at: new Date().toISOString() },
];

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe("NotificationsBell", () => {
  it("renders unread counter, severities and categories", async () => {
    rpcMock.mockResolvedValueOnce({ data: NOTIFS, error: null });
    render(<NotificationsBell />);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("notification_list_for_user", expect.any(Object)));
    // unread badge = 2
    expect(await screen.findByText("2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => screen.getByText("Crítico"));
    expect(screen.getByText("alerts")).toBeInTheDocument();
    expect(screen.getByText("billing")).toBeInTheDocument();
    expect(screen.getByText("finance")).toBeInTheDocument();
  });

  it("calls notification_mark_read on click", async () => {
    rpcMock.mockResolvedValueOnce({ data: NOTIFS, error: null });
    rpcMock.mockResolvedValue({ data: null, error: null });
    render(<NotificationsBell />);
    fireEvent.click(await screen.findByRole("button"));
    const item = await screen.findByText("Crítico");
    fireEvent.click(item.closest("button")!);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("notification_mark_read", { _notification_id: "n1" }),
    );
  });

  it("calls notification_mark_all_read", async () => {
    rpcMock.mockResolvedValueOnce({ data: NOTIFS, error: null });
    rpcMock.mockResolvedValue({ data: null, error: null });
    render(<NotificationsBell />);
    fireEvent.click(await screen.findByRole("button"));
    fireEvent.click(await screen.findByRole("button", { name: /Marcar todas/ }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("notification_mark_all_read", { _category: null }),
    );
  });

  it("shows empty state", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    render(<NotificationsBell />);
    fireEvent.click(await screen.findByRole("button"));
    expect(await screen.findByText(/Sem notificações/)).toBeInTheDocument();
  });

  it("does not crash on RPC error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    render(<NotificationsBell />);
    fireEvent.click(await screen.findByRole("button"));
    expect(await screen.findByText(/Sem notificações/)).toBeInTheDocument();
  });

  it("never writes directly to notifications table", async () => {
    rpcMock.mockResolvedValueOnce({ data: NOTIFS, error: null });
    rpcMock.mockResolvedValue({ data: null, error: null });
    render(<NotificationsBell />);
    fireEvent.click(await screen.findByRole("button"));
    fireEvent.click(await screen.findByRole("button", { name: /Marcar todas/ }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(fromMock).not.toHaveBeenCalledWith("notifications");
  });
});
