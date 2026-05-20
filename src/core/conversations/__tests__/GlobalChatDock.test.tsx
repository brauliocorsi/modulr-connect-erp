import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// --- Supabase mock ----------------------------------------------------------
const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: any[]) => rpcMock(...a),
    from: (...a: any[]) => fromMock(...a),
  },
}));

// --- Auth mock --------------------------------------------------------------
let authUser: any = { id: "user-1", email: "u@e.com" };
vi.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: authUser, session: null, loading: false, signOut: vi.fn() }),
}));

// --- Sonner mock ------------------------------------------------------------
const toastErr = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastErr(m), success: vi.fn() },
}));

import GlobalChatDock from "../GlobalChatDock";

// Fixture data
const THREADS = [
  {
    id: "th1",
    title: "Pedido #1",
    status: "open",
    visibility: "internal",
    entity_type: "sale_order",
    entity_id: "so-1",
    created_at: "2026-05-19T10:00:00Z",
  },
  {
    id: "th2",
    title: "Cliente B",
    status: "open",
    visibility: "customer_visible",
    entity_type: null,
    entity_id: null,
    created_at: "2026-05-19T11:00:00Z",
  },
];
const PARTICIPANTS = [
  { thread_id: "th1", left_at: null },
  { thread_id: "th2", left_at: null },
];
const LAST_MSGS = [
  { thread_id: "th1", message: "última th1", created_at: "2026-05-19T12:00:00Z" },
  { thread_id: "th2", message: "última th2", created_at: "2026-05-19T11:30:00Z" },
];
const MESSAGES_TH1 = [
  {
    id: "m1",
    thread_id: "th1",
    sender_user_id: "user-2",
    sender_type: "user",
    message: "Olá interno",
    visibility: "internal",
    created_at: "2026-05-19T12:00:00Z",
  },
];

// Build a chainable mock that resolves to {data, error} when awaited.
function buildBuilder(result: { data: any; error: any }) {
  const thenable: any = {};
  const methods = ["select", "eq", "is", "in", "order", "limit"];
  for (const m of methods) thenable[m] = vi.fn().mockReturnValue(thenable);
  thenable.then = (resolve: any) => Promise.resolve(result).then(resolve);
  return thenable;
}

function defaultFromRouter() {
  fromMock.mockImplementation((table: string) => {
    if (table === "conversation_participants") return buildBuilder({ data: PARTICIPANTS, error: null });
    if (table === "conversation_threads") return buildBuilder({ data: THREADS, error: null });
    if (table === "conversation_messages") {
      // Distinguish list-of-last vs single-thread by inspecting later .eq call.
      // Return both at once and let the component choose; we route via call order.
      // Simpler: always return MESSAGES_TH1 when .eq("thread_id", x) is called,
      // else last messages list. We track via a builder variant.
      const b: any = {};
      let usedEq = false;
      const methods = ["select", "is", "in", "order", "limit"];
      for (const m of methods) b[m] = vi.fn().mockReturnValue(b);
      b.eq = vi.fn().mockImplementation(() => {
        usedEq = true;
        return b;
      });
      b.then = (resolve: any) =>
        Promise.resolve(usedEq ? { data: MESSAGES_TH1, error: null } : { data: LAST_MSGS, error: null }).then(resolve);
      return b;
    }
    return buildBuilder({ data: [], error: null });
  });
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  toastErr.mockReset();
  localStorage.clear();
  authUser = { id: "user-1", email: "u@e.com" };
  defaultFromRouter();
  rpcMock.mockResolvedValue({ data: null, error: null });
});

function renderDock(initialEntries: string[] = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <GlobalChatDock />
    </MemoryRouter>,
  );
}

describe("GlobalChatDock", () => {
  it("does not render when user is unauthenticated", () => {
    authUser = null;
    const { container } = renderDock();
    expect(container.firstChild).toBeNull();
  });

  it("renders floating launcher when authenticated", async () => {
    renderDock();
    expect(await screen.findByTestId("global-chat-launcher")).toBeInTheDocument();
  });

  it("does not render on /portal/:token route", () => {
    const { container } = renderDock(["/portal/abc123"]);
    expect(container.firstChild).toBeNull();
  });

  it("shows unread badge when there are recent messages and nothing seen", async () => {
    renderDock();
    await screen.findByTestId("global-chat-launcher");
    expect(await screen.findByTestId("global-chat-unread-badge")).toBeInTheDocument();
  });

  it("opens the panel when launcher is clicked and lists threads", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    expect(await screen.findByTestId("global-chat-panel")).toBeInTheDocument();
    expect(await screen.findByText("Pedido #1")).toBeInTheDocument();
    expect(screen.getByText("Cliente B")).toBeInTheDocument();
  });

  it("minimizes panel and persists state in localStorage", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    await screen.findByTestId("global-chat-panel");
    fireEvent.click(screen.getByLabelText("Minimizar"));
    expect(screen.queryByTestId("global-chat-panel")).not.toBeInTheDocument();
    const persisted = JSON.parse(localStorage.getItem("erp.globalChatDock.state") || "{}");
    expect(persisted.state).toBe("minimized");
  });

  it("selects a thread and loads its messages", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    fireEvent.click(await screen.findByTestId("global-chat-thread-th1"));
    expect(await screen.findByText("Olá interno")).toBeInTheDocument();
  });

  it("sends a message via conversation_add_message RPC", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    fireEvent.click(await screen.findByTestId("global-chat-thread-th1"));
    await screen.findByText("Olá interno");
    fireEvent.change(screen.getByTestId("global-chat-input"), { target: { value: "minha resposta" } });
    fireEvent.click(screen.getByTestId("global-chat-send"));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "conversation_add_message",
        expect.objectContaining({ _thread_id: "th1", _message: "minha resposta", _visibility: "internal" }),
      ),
    );
  });

  it("does not allow sending empty messages", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    fireEvent.click(await screen.findByTestId("global-chat-thread-th1"));
    await screen.findByText("Olá interno");
    const sendBtn = screen.getByTestId("global-chat-send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.click(sendBtn);
    expect(rpcMock).not.toHaveBeenCalledWith("conversation_add_message", expect.anything());
  });

  it("shows error state when thread query fails", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "conversation_participants")
        return buildBuilder({ data: null, error: { message: "boom" } });
      return buildBuilder({ data: [], error: null });
    });
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    expect(await screen.findByTestId("global-chat-error")).toHaveTextContent("boom");
  });

  it("never writes directly to conversation_messages / conversation_threads", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    fireEvent.click(await screen.findByTestId("global-chat-thread-th1"));
    await screen.findByText("Olá interno");
    fireEvent.change(screen.getByTestId("global-chat-input"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("global-chat-send"));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("conversation_add_message", expect.any(Object)));
    // from() is used only for read selects; ensure no chained .insert/.update/.delete was returned by builders.
    const builders = fromMock.mock.results.map((r) => r.value);
    for (const b of builders) {
      expect(b.insert).toBeUndefined();
      expect(b.update).toBeUndefined();
      expect(b.upsert).toBeUndefined();
      expect(b.delete).toBeUndefined();
    }
  });

  it("does not use legacy record_messages table", async () => {
    renderDock();
    fireEvent.click(await screen.findByTestId("global-chat-launcher"));
    await screen.findByTestId("global-chat-panel");
    expect(fromMock).not.toHaveBeenCalledWith("record_messages");
  });
});
