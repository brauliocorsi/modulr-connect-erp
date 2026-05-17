import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---- Mocks ----
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => rpcMock(...args),
    from: (...args: any[]) => fromMock(...args),
  },
}));

const toastErr = vi.fn();
const toastOk = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastErr(m), success: (m: string) => toastOk(m) },
}));

import WorkOrdersSection from "../WorkOrdersSection";

const MO_ID = "mo-1";

const WOS = [
  { id: "wo-pending", sequence: 1, name: "Corte", state: "pending", planned_minutes: 30, actual_duration_minutes: null, qty_done: 0, qty_scrap: 0, is_qc: false, work_center: { name: "WC1" }, machine: null, work_center_id: "wc1" },
  { id: "wo-ready", sequence: 2, name: "Costura", state: "ready", planned_minutes: 60, actual_duration_minutes: null, qty_done: 0, qty_scrap: 0, is_qc: false, work_center: { name: "WC1" }, machine: null, work_center_id: "wc1" },
  { id: "wo-running", sequence: 3, name: "Acabamento", state: "in_progress", planned_minutes: 20, actual_duration_minutes: 5, qty_done: 1, qty_scrap: 0, is_qc: false, work_center: { name: "WC1" }, machine: null, work_center_id: "wc1" },
  { id: "wo-paused", sequence: 4, name: "Embalagem", state: "paused", planned_minutes: 10, actual_duration_minutes: 3, qty_done: 0, qty_scrap: 0, is_qc: false, work_center: { name: "WC1" }, machine: null, work_center_id: "wc1" },
  { id: "wo-blocked", sequence: 5, name: "Bloqueada", state: "blocked", planned_minutes: 10, actual_duration_minutes: 0, qty_done: 0, qty_scrap: 0, is_qc: false, block_reason: "Falta material", work_center: { name: "WC1" }, machine: null, work_center_id: "wc1" },
  { id: "wo-done", sequence: 6, name: "Done", state: "done", planned_minutes: 5, actual_duration_minutes: 4, qty_done: 1, qty_scrap: 0, is_qc: false, work_center: { name: "WC1" }, machine: null, work_center_id: "wc1" },
  { id: "wo-qc", sequence: 7, name: "QC", state: "ready", planned_minutes: 5, actual_duration_minutes: null, qty_done: 0, qty_scrap: 0, is_qc: true, work_center: { name: "WC1" }, machine: null, work_center_id: "wc1" },
];

function setupFrom() {
  fromMock.mockImplementation((table: string) => {
    const builder: any = {
      _table: table,
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      order: () => Promise.resolve({ data: table === "mo_operations" ? WOS : [], error: null }),
      then: (fn: any) => Promise.resolve({ data: table === "mo_operations" ? WOS : [], error: null }).then(fn),
    };
    return builder;
  });
}

function renderWO() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkOrdersSection moId={MO_ID} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  toastErr.mockReset();
  toastOk.mockReset();
  setupFrom();
});

describe("WorkOrdersSection", () => {
  it("renders list of work orders and all states", async () => {
    renderWO();
    await waitFor(() => expect(screen.getByText("Corte")).toBeInTheDocument());
    // States rendered as badges
    expect(screen.getByText("Aguardando")).toBeInTheDocument();
    expect(screen.getAllByText("Pronta").length).toBeGreaterThan(0);
    expect(screen.getByText("Em execução")).toBeInTheDocument();
    expect(screen.getByText("Pausada")).toBeInTheDocument();
    expect(screen.getByText("Bloqueada")).toBeInTheDocument();
    expect(screen.getByText("Concluída")).toBeInTheDocument();
  });

  it("invokes work_order_resume when Retomar pressed", async () => {
    rpcMock.mockResolvedValue({ error: null });
    renderWO();
    await waitFor(() => screen.getByText("Embalagem"));
    const row = screen.getByText("Embalagem").closest("tr")!;
    const btns = within(row).getAllByRole("button");
    fireEvent.click(btns[0]);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("work_order_resume", { _work_order_id: "wo-paused" }));
  });

  it("invokes work_order_start with employee/machine null", async () => {
    rpcMock.mockResolvedValue({ error: null });
    renderWO();
    await waitFor(() => screen.getByText("Costura"));
    const row = screen.getByText("Costura").closest("tr")!;
    fireEvent.click(within(row).getAllByRole("button")[0]);
    await waitFor(() => screen.getByText(/Iniciar — Costura/));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("work_order_start", { _work_order_id: "wo-ready", _employee_id: null, _machine_id: null })
    );
  });

  it("invokes work_order_pause with reason", async () => {
    rpcMock.mockResolvedValue({ error: null });
    renderWO();
    await waitFor(() => screen.getByText("Acabamento"));
    const row = screen.getByText("Acabamento").closest("tr")!;
    const btns = within(row).getAllByRole("button");
    fireEvent.click(btns[0]); // pause icon (first action)
    await waitFor(() => screen.getByText(/Pausar — Acabamento/));
    fireEvent.change(screen.getByPlaceholderText("Motivo da pausa"), { target: { value: "Pausa almoço" } });
    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("work_order_pause", { _work_order_id: "wo-running", _reason: "Pausa almoço" })
    );
  });

  it("invokes work_order_finish with qty_done, qty_scrap, notes", async () => {
    rpcMock.mockResolvedValue({ error: null });
    renderWO();
    await waitFor(() => screen.getByText("Acabamento"));
    const row = screen.getByText("Acabamento").closest("tr")!;
    const btns = within(row).getAllByRole("button");
    fireEvent.click(btns[1]); // finish
    await waitFor(() => screen.getByText(/Concluir — Acabamento/));
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "10" } });
    fireEvent.change(inputs[1], { target: { value: "2" } });
    fireEvent.change(screen.getByPlaceholderText("Notas"), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("work_order_finish", {
        _work_order_id: "wo-running",
        _qty_done: 10,
        _qty_scrap: 2,
        _notes: "ok",
      })
    );
  });

  it("invokes work_order_quality_check from QC button", async () => {
    rpcMock.mockResolvedValue({ error: null });
    renderWO();
    await waitFor(() => screen.getAllByText("QC").length);
    const row = screen.getByText("QC", { selector: "div" }).closest("tr")!;
    const btns = within(row).getAllByRole("button");
    // For a ready+QC row: Start, QC, Issue
    fireEvent.click(btns[1]);
    await waitFor(() => screen.getByText(/Controle de qualidade/));
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("work_order_quality_check", expect.objectContaining({ _work_order_id: "wo-qc", _result: "pass" }))
    );
  });

  it("invokes work_order_report_issue", async () => {
    rpcMock.mockResolvedValue({ error: null });
    renderWO();
    await waitFor(() => screen.getByText("Costura"));
    const row = screen.getByText("Costura").closest("tr")!;
    const btns = within(row).getAllByRole("button");
    // ready row: Start, Issue
    fireEvent.click(btns[btns.length - 1]);
    await waitFor(() => screen.getByText(/Reportar problema/));
    fireEvent.change(screen.getByPlaceholderText("Descrição"), { target: { value: "quebrou" } });
    fireEvent.click(screen.getByRole("button", { name: "Reportar" }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("work_order_report_issue", expect.objectContaining({ _work_order_id: "wo-ready", _description: "quebrou" }))
    );
  });

  it("exposes new operational issue kinds in dropdown", async () => {
    renderWO();
    await waitFor(() => screen.getByText("Costura"));
    const row = screen.getByText("Costura").closest("tr")!;
    const btns = within(row).getAllByRole("button");
    fireEvent.click(btns[btns.length - 1]);
    await waitFor(() => screen.getByText(/Reportar problema/));
    // The default value shows in the trigger
    expect(screen.getByText("Falta de material")).toBeInTheDocument();
  });

  it("shows error toast for start failure (e.g. backend rule)", async () => {
    rpcMock.mockResolvedValue({ error: { message: "OPEN_BLOCKING_ISSUES" } });
    renderWO();
    await waitFor(() => screen.getByText("Costura"));
    const row = screen.getByText("Costura").closest("tr")!;
    fireEvent.click(within(row).getAllByRole("button")[0]);
    await waitFor(() => screen.getByText(/Iniciar — Costura/));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith("OPEN_BLOCKING_ISSUES"));
  });
});
