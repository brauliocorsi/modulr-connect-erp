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

const toastErr = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastErr(m), success: vi.fn() },
}));

import { RecordConversations } from "../RecordConversations";

const THREADS = [
  { id: "th1", title: "Interno A", status: "open", visibility: "internal", created_at: new Date().toISOString() },
  { id: "th2", title: "Cliente B", status: "open", visibility: "customer_visible", created_at: new Date().toISOString() },
];
const MESSAGES = [
  { id: "m1", thread_id: "th1", author_id: null, body: "olá interno", visibility: "internal", created_at: new Date().toISOString() },
  { id: "m2", thread_id: "th1", author_id: null, body: "para cliente", visibility: "customer_visible", created_at: new Date().toISOString() },
];

function rpcRouter(name: string) {
  if (name === "conversation_list_for_entity") return { data: THREADS, error: null };
  if (name === "conversation_messages") return { data: MESSAGES, error: null };
  if (name === "conversation_create") return { data: "new-thread-id", error: null };
  if (name === "conversation_add_message") return { data: null, error: null };
  return { data: null, error: null };
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  toastErr.mockReset();
  rpcMock.mockImplementation((name: string) => Promise.resolve(rpcRouter(name)));
});

describe("RecordConversations", () => {
  it("lists threads via conversation_list_for_entity", async () => {
    render(<RecordConversations entityType="ticket" entityId="tk-1" />);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("conversation_list_for_entity", {
        _entity_type: "ticket",
        _entity_id: "tk-1",
      }),
    );
    expect(await screen.findByText("Interno A")).toBeInTheDocument();
    expect(screen.getByText("Cliente B")).toBeInTheDocument();
  });

  it("lists messages via conversation_messages", async () => {
    render(<RecordConversations entityType="ticket" entityId="tk-1" />);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("conversation_messages", {
        _thread_id: "th1",
        _visibility_filter: null,
      }),
    );
    expect(await screen.findByText("olá interno")).toBeInTheDocument();
  });

  it("creates thread via conversation_create", async () => {
    render(<RecordConversations entityType="ticket" entityId="tk-1" />);
    const input = await screen.findByPlaceholderText(/Nova conversa/);
    fireEvent.change(input, { target: { value: "Nova" } });
    fireEvent.click(input.parentElement!.querySelector("button")!);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "conversation_create",
        expect.objectContaining({
          _payload: expect.objectContaining({ title: "Nova", entity_type: "ticket", entity_id: "tk-1", visibility: "internal" }),
        }),
      ),
    );
  });

  it("sends message via conversation_add_message", async () => {
    render(<RecordConversations entityType="ticket" entityId="tk-1" />);
    await screen.findByText("olá interno");
    fireEvent.change(screen.getByPlaceholderText(/Escreva uma mensagem/), { target: { value: "msg" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "conversation_add_message",
        expect.objectContaining({ _thread_id: "th1", _message: "msg", _visibility: "internal" }),
      ),
    );
  });

  it("customerView filters internal threads and applies customer_visible filter", async () => {
    render(<RecordConversations entityType="ticket" entityId="tk-1" customerView />);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("conversation_list_for_entity", expect.any(Object)));
    expect(await screen.findByText("Cliente B")).toBeInTheDocument();
    expect(screen.queryByText("Interno A")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("conversation_messages", {
        _thread_id: "th2",
        _visibility_filter: "customer_visible",
      }),
    );
  });

  it("shows empty state when no threads", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "conversation_list_for_entity") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });
    render(<RecordConversations entityType="ticket" entityId="tk-1" />);
    expect(await screen.findByText(/Sem conversas/)).toBeInTheDocument();
  });

  it("shows toast on send error", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "conversation_add_message") return Promise.resolve({ data: null, error: { message: "DENIED" } });
      return Promise.resolve(rpcRouter(name));
    });
    render(<RecordConversations entityType="ticket" entityId="tk-1" />);
    await screen.findByText("olá interno");
    fireEvent.change(screen.getByPlaceholderText(/Escreva uma mensagem/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith("DENIED"));
  });

  it("never writes directly to conversation_messages", async () => {
    render(<RecordConversations entityType="ticket" entityId="tk-1" />);
    await screen.findByText("olá interno");
    fireEvent.change(screen.getByPlaceholderText(/Escreva uma mensagem/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("conversation_add_message", expect.any(Object)));
    expect(fromMock).not.toHaveBeenCalledWith("conversation_messages");
  });
});
