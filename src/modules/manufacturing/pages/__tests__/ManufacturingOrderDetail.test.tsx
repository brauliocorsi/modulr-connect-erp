import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpcMock = vi.fn();

function makeQuery(result: { data: unknown; error: null | { message: string } } = { data: [], error: null }) {
  const q: Record<string, unknown> = {
    then: (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF),
  };
  ["select","insert","update","upsert","delete","eq","neq","in","gt","gte","lt","lte","is","not","or","order","limit","maybeSingle","single"]
    .forEach((m) => { q[m] = vi.fn(() => q); });
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  q.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return q;
}

const moRow = {
  id: "mo-1",
  code: "MO0001",
  state: "ready",
  origin: "sale_order",
  qty: 5,
  due_date: "2026-06-01",
  created_at: "2026-01-01T10:00:00Z",
  blocked_reason: null,
  notes: null,
  product: { name: "Cadeira", internal_ref: "P-001" },
  partner: { name: "Cliente A" },
  sale: { id: "so-1", name: "SO0001" },
  bom: { code: "BOM-1" },
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: (table: string) => {
      if (table === "manufacturing_orders") {
        const q = makeQuery();
        q.maybeSingle = vi.fn(() => Promise.resolve({ data: moRow, error: null }));
        return q;
      }
      return makeQuery();
    },
    channel: () => ({ on: function (this: unknown) { return this; }, subscribe: () => ({}) }),
    removeChannel: vi.fn(),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign((m: string) => toastSuccess(m), {
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
    info: vi.fn(),
  }),
}));

vi.mock("../../components/WorkOrdersSection", () => ({ default: () => null }));
vi.mock("@/core/timeline/RecordTimeline", () => ({ RecordTimeline: () => <div data-testid="timeline" /> }));
vi.mock("@/core/tasks/RecordTasks", () => ({ RecordTasks: () => <div data-testid="tasks" /> }));
vi.mock("@/core/conversations/RecordConversations", () => ({ RecordConversations: () => <div data-testid="conversations" /> }));

import ManufacturingOrderDetail from "../ManufacturingOrderDetail";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/manufacturing/orders/mo-1"]}>
        <Routes>
          <Route path="/manufacturing/orders/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ManufacturingOrderDetail />, { wrapper: Wrapper });
}

beforeEach(() => {
  rpcMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe("ManufacturingOrderDetail (F22-R3)", () => {
  it("renders EntityHeader with MO code, product and manufacturing status badge", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/MO0001/)).toBeInTheDocument());
    expect(screen.getByText("Pronta")).toBeInTheDocument();
    expect(screen.getByText("Cadeira", { exact: false })).toBeInTheDocument();
  });

  it("renders metadata grid with quantity and BOM", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("BOM-1")).toBeInTheDocument());
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("Fechar OF requires confirm and calls close_mo RPC", async () => {
    renderPage();
    const btn = await screen.findByRole("button", { name: /Fechar OF/i });
    fireEvent.click(btn);
    const confirm = await screen.findAllByRole("button", { name: /Fechar OF/i });
    fireEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("close_mo", { _mo: "mo-1" }));
  });

  it("Gerar necessidades calls mfg_create_needs_for_mo RPC", async () => {
    renderPage();
    const btn = await screen.findByRole("button", { name: /Gerar necessidades/i });
    fireEvent.click(btn);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("mfg_create_needs_for_mo", { _mo: "mo-1" }));
  });

  it("mounts Timeline, Tasks and Conversations panels", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("timeline")).toBeInTheDocument());
    expect(screen.getByTestId("tasks")).toBeInTheDocument();
    expect(screen.getByTestId("conversations")).toBeInTheDocument();
  });

  it("Atualizar refresh button is present", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /Atualizar/i })).toBeInTheDocument();
  });
});
