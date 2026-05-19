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

import { RecordTasks } from "../RecordTasks";

const TASKS = [
  { id: "t1", title: "Aberta", description: null, status: "open", priority: "normal", due_date: null, assigned_to: null, assigned_group: null, created_at: new Date().toISOString(), completed_at: null },
  { id: "t2", title: "Atrasada", description: "x", status: "in_progress", priority: "urgent", due_date: new Date(Date.now() - 86400000).toISOString(), assigned_to: null, assigned_group: null, created_at: new Date().toISOString(), completed_at: null },
];

function mockTasks(data: any[]) {
  fromMock.mockImplementation(() => {
    const b: any = { select: () => b, eq: () => b, order: () => Promise.resolve({ data, error: null }) };
    return b;
  });
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  toastErr.mockReset();
});

describe("RecordTasks", () => {
  it("lists tasks with status/priority badges and overdue", async () => {
    mockTasks(TASKS);
    render(<RecordTasks entityType="sale_order" entityId="so-1" />);
    expect(await screen.findByText("Aberta")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("urgent")).toBeInTheDocument();
    expect(screen.getByText(/Atrasada ·/)).toBeInTheDocument();
  });

  it("creates task via erp_task_create", async () => {
    mockTasks([]);
    rpcMock.mockResolvedValue({ data: null, error: null });
    render(<RecordTasks entityType="sale_order" entityId="so-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Nova/ }));
    fireEvent.change(screen.getByPlaceholderText("Título"), { target: { value: "Nova T" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "erp_task_create",
        expect.objectContaining({ _payload: expect.objectContaining({ title: "Nova T", entity_type: "sale_order", entity_id: "so-1" }) }),
      ),
    );
  });

  it("starts task via erp_task_start", async () => {
    mockTasks(TASKS);
    rpcMock.mockResolvedValue({ data: null, error: null });
    render(<RecordTasks entityType="sale_order" entityId="so-1" />);
    const startBtn = await screen.findByTitle("Iniciar");
    fireEvent.click(startBtn);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("erp_task_start", { _task_id: "t1" }),
    );
  });

  it("completes task via erp_task_complete", async () => {
    mockTasks(TASKS);
    rpcMock.mockResolvedValue({ data: null, error: null });
    render(<RecordTasks entityType="sale_order" entityId="so-1" />);
    const done = (await screen.findAllByTitle("Concluir"))[0];
    fireEvent.click(done);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("erp_task_complete", { _task_id: "t1", _notes: null }),
    );
  });

  it("cancels task via erp_task_cancel with reason", async () => {
    mockTasks(TASKS);
    rpcMock.mockResolvedValue({ data: null, error: null });
    vi.stubGlobal("prompt", () => "motivo");
    render(<RecordTasks entityType="sale_order" entityId="so-1" />);
    const cancel = (await screen.findAllByTitle("Cancelar"))[0];
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("erp_task_cancel", { _task_id: "t1", _reason: "motivo" }),
    );
    vi.unstubAllGlobals();
  });

  it("shows toast on backend error", async () => {
    mockTasks(TASKS);
    rpcMock.mockResolvedValue({ data: null, error: { message: "INVALID_TRANSITION" } });
    render(<RecordTasks entityType="sale_order" entityId="so-1" />);
    fireEvent.click(await screen.findByTitle("Iniciar"));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith("INVALID_TRANSITION"));
  });

  it("never writes directly to erp_tasks", async () => {
    mockTasks(TASKS);
    rpcMock.mockResolvedValue({ data: null, error: null });
    render(<RecordTasks entityType="sale_order" entityId="so-1" />);
    fireEvent.click(await screen.findByTitle("Iniciar"));
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const writes = fromMock.mock.results.flatMap((r) => {
      const b = r.value;
      return ["insert", "update", "upsert", "delete"].filter((m) => b && typeof b[m] === "function" && b[m].mock?.calls?.length);
    });
    expect(writes).toHaveLength(0);
  });
});
