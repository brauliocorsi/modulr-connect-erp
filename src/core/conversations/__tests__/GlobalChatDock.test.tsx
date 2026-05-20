import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// --- Supabase mock ----------------------------------------------------------
const rpcMock = vi.fn();
const fromMock = vi.fn();
const onMock = vi.fn();
const subscribeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: any[]) => rpcMock(...a),
    from: (...a: any[]) => fromMock(...a),
    channel: vi.fn(() => ({ on: onMock, subscribe: subscribeMock })),
    removeChannel: vi.fn(),
  },
}));

// --- Auth mock --------------------------------------------------------------
let authUser: any = { id: "user-1", email: "u@e.com" };
vi.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: authUser, session: null, loading: false, signOut: vi.fn() }),
}));

const toastErr = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastErr(m), success: vi.fn() },
}));

import GlobalChatDock from "../GlobalChatDock";

const UNIFIED = [
  {
    id: "th-entity",
    thread_type: "entity",
    title: "Pedido #1",
    entity_type: "sale_order",
    entity_id: "11111111-1111-1111-1111-111111111111",
    channel_id: null,
    visibility: "internal",
    status: "open",
    last_activity: "2026-05-19T12:00:00Z",
    last_message: "última th-entity",
    last_message_at: "2026-05-19T12:00:00Z",
    unread_count: 2,
    last_read_at: null,
    pinned: false,
    muted: false,
  },
  {
    id: "th-dm",
    thread_type: "dm",
    title: "Alice",
    entity_type: null,
    entity_id: null,
    channel_id: null,
    visibility: "internal",
    status: "open",
    last_activity: "2026-05-19T11:30:00Z",
    last_message: "oi",
    last_message_at: "2026-05-19T11:30:00Z",
    unread_count: 0,
    last_read_at: null,
    pinned: false,
    muted: false,
  },
  {
    id: "th-ch",
    thread_type: "channel",
    title: "geral",
    entity_type: null,
    entity_id: null,
    channel_id: "ch-x",
    visibility: "internal",
    status: "open",
    last_activity: "2026-05-19T10:00:00Z",
    last_message: "hello",
    last_message_at: "2026-05-19T10:00:00Z",
    unread_count: 1,
    last_read_at: null,
    pinned: false,
    muted: false,
  },
];

const MESSAGES = [
  {
    id: "m1",
    thread_id: "th-entity",
    sender_user_id: "user-2",
    sender_type: "user",
    message: "Olá interno",
    visibility: "internal",
    created_at: "2026-05-19T12:00:00Z",
  },
];

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  onMock.mockReset();
  subscribeMock.mockReset();
  onMock.mockReturnValue({ on: onMock, subscribe: subscribeMock });
  toastErr.mockReset();
  localStorage.clear();
  authUser = { id: "user-1", email: "u@e.com" };
  rpcMock.mockImplementation((name: string) => {
    if (name === "conversation_unified_list") return Promise.resolve({ data: UNIFIED, error: null });
    if (name === "conversation_get_messages") return Promise.resolve({ data: MESSAGES, error: null });
    if (name === "conversation_mark_read") return Promise.resolve({ data: { ok: true }, error: null });
    if (name === "conversation_send_message") return Promise.resolve({ data: "new-id", error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

function renderDock(initialEntries: string[] = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <GlobalChatDock />
    </MemoryRouter>,
  );
}

describe("GlobalChatDock — unified", () => {
  it("does not render when user is unauthenticated", () => {
    authUser = null;
    const { container } = renderDock();
    expect(container.firstChild).toBeNull();
  });

  it("does not render on /portal route", () => {
    const { container } = renderDock(["/portal/abc"]);
    expect(container.firstChild).toBeNull();
  });

  it("shows server-side unread badge (sum of unread_count)", async () => {
    renderDock();
    const badge = await screen.findByTestId("global-chat-unread-badge");
    // 2 + 0 + 1 = 3
    expect(badge.textContent).toBe("3");
  });

  it("opens panel and lists unified threads (DM/channel/entity)", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    expect(await screen.findByTestId("global-chat-panel")).toBeInTheDocument();
    expect(await screen.findByText("Pedido #1")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("geral")).toBeInTheDocument();
  });

  it("subscribes to legacy Discuss messages so the dock refreshes DMs sent there", async () => {
    renderDock();
    await waitFor(() =>
      expect(onMock).toHaveBeenCalledWith(
        "postgres_changes",
        expect.objectContaining({ event: "INSERT", schema: "public", table: "chat_messages" }),
        expect.any(Function),
      ),
    );
  });

  it("filters by DM tab", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    await screen.findByText("Pedido #1");
    fireEvent.click(screen.getByRole("tab", { name: /DMs/ }));
    await waitFor(() => {
      expect(screen.queryByText("Pedido #1")).not.toBeInTheDocument();
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });
  });

  it("filters by Canais tab", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    await screen.findByText("Pedido #1");
    fireEvent.click(screen.getByRole("tab", { name: /Canais/ }));
    await waitFor(() => {
      expect(screen.queryByText("Alice")).not.toBeInTheDocument();
      expect(screen.getByText("geral")).toBeInTheDocument();
    });
  });

  it("shows 'Página' tab content when route maps to an entity", async () => {
    renderDock(["/sales/orders/11111111-1111-1111-1111-111111111111"]);
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    await screen.findByText("Pedido #1");
    fireEvent.click(screen.getByRole("tab", { name: /Página/ }));
    await waitFor(() => {
      expect(screen.getByText("Pedido #1")).toBeInTheDocument();
      expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    });
  });

  it("opens a thread and calls conversation_mark_read", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    fireEvent.click(await screen.findByTestId("global-chat-thread-th-entity"));
    await screen.findByText("Olá interno");
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("conversation_mark_read", { _thread_id: "th-entity" }),
    );
    expect(rpcMock).toHaveBeenCalledWith("conversation_get_messages", { _thread_id: "th-entity", _limit: 100 });
  });

  it("sends a message via conversation_send_message RPC", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    fireEvent.click(await screen.findByTestId("global-chat-thread-th-entity"));
    await screen.findByText("Olá interno");
    fireEvent.change(screen.getByTestId("global-chat-input"), { target: { value: "minha resposta" } });
    fireEvent.click(screen.getByTestId("global-chat-send"));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "conversation_send_message",
        expect.objectContaining({ _thread_id: "th-entity", _body: "minha resposta", _visibility: "internal" }),
      ),
    );
  });

  it("never uses legacy record_messages table nor direct conversation table writes", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    fireEvent.click(await screen.findByTestId("global-chat-thread-th-entity"));
    await screen.findByText("Olá interno");
    fireEvent.change(screen.getByTestId("global-chat-input"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("global-chat-send"));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("conversation_send_message", expect.any(Object)));
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("shows error state when unified list fails", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "conversation_unified_list") return Promise.resolve({ data: null, error: { message: "boom" } });
      return Promise.resolve({ data: null, error: null });
    });
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    expect(await screen.findByTestId("global-chat-error")).toHaveTextContent("boom");
  });
});
