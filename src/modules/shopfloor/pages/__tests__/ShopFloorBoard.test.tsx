import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fromMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...a: any[]) => fromMock(...a), rpc: vi.fn() },
}));

const WOS = [
  { id: "1", sequence: 1, name: "Corte", state: "pending", planned_minutes: 30, actual_duration_minutes: null, qty_done: 0, qty_scrap: 0, is_qc: false, mo_id: "mo1", work_center_id: "wc1", machine_id: null, mo: { id: "mo1", code: "MO-001", priority: "normal", qty: 5, due_date: null, state: "planned", product: { name: "Mesa" } }, work_center: { name: "WC1" }, machine: null },
  { id: "2", sequence: 2, name: "Costura", state: "in_progress", planned_minutes: 30, actual_duration_minutes: 5, qty_done: 1, qty_scrap: 0, is_qc: false, mo_id: "mo1", work_center_id: "wc1", machine_id: null, mo: { id: "mo1", code: "MO-001", priority: "normal", qty: 5, due_date: null, state: "in_progress", product: { name: "Mesa" } }, work_center: { name: "WC1" }, machine: null },
  { id: "3", sequence: 3, name: "Pintura", state: "blocked", planned_minutes: 30, actual_duration_minutes: 0, qty_done: 0, qty_scrap: 0, is_qc: false, mo_id: "mo2", work_center_id: "wc2", machine_id: null, mo: { id: "mo2", code: "MO-002", priority: "high", qty: 1, due_date: null, state: "planned", product: { name: "Cadeira" } }, work_center: { name: "WC2" }, machine: null, block_reason: "Falta material" },
  { id: "4", sequence: 1, name: "Done WO", state: "done", planned_minutes: 5, actual_duration_minutes: 4, qty_done: 1, qty_scrap: 0, is_qc: false, mo_id: "mo3", work_center_id: "wc1", machine_id: null, mo: { id: "mo3", code: "MO-003", priority: "normal", qty: 1, due_date: null, state: "done", product: { name: "Banco" } }, work_center: { name: "WC1" }, machine: null },
];

beforeEach(() => {
  fromMock.mockReset();
  fromMock.mockImplementation((table: string) => {
    const data =
      table === "mo_operations" ? WOS :
      table === "work_centers" ? [{ id: "wc1", name: "WC1" }, { id: "wc2", name: "WC2" }] :
      table === "manufacturing_machines" ? [{ id: "m1", name: "M1" }] : [];
    const builder: any = {};
    const ret = () => builder;
    builder.select = ret; builder.eq = ret; builder.order = ret; builder.limit = ret; builder.is = ret;
    builder.then = (fn: any, rej?: any) => Promise.resolve({ data }).then(fn, rej);
    return builder;
  });
});

import ShopFloorBoard from "../ShopFloorBoard";

function renderBoard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ShopFloorBoard /></MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ShopFloorBoard", () => {
  it("groups work orders by state across columns", async () => {
    renderBoard();
    await waitFor(() => expect(screen.getAllByText("MO-001").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Aguardando").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Em execução").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bloqueada").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Concluída").length).toBeGreaterThan(0);
    expect(screen.getByText(/4 work order/)).toBeInTheDocument();
  });

  it("filters by search term", async () => {
    renderBoard();
    await waitFor(() => screen.getAllByText("MO-001"));
    fireEvent.change(screen.getByPlaceholderText(/Buscar OF/), { target: { value: "MO-002" } });
    await waitFor(() => expect(screen.queryByText("MO-001")).not.toBeInTheDocument());
    expect(screen.getByText("MO-002")).toBeInTheDocument();
    expect(screen.getByText(/1 work order/)).toBeInTheDocument();
  });
});
