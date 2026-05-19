import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { OperationalDataTable, type Column } from "../OperationalDataTable";

type Row = { id: string; name: string; status: string };
const ROWS: Row[] = [
  { id: "1", name: "Alpha", status: "new" },
  { id: "2", name: "Beta", status: "done" },
];
const COLUMNS: Column<Row>[] = [
  { key: "name", header: "Nome", cell: (r) => r.name },
  { key: "status", header: "Status", cell: (r) => r.status },
];

describe("OperationalDataTable", () => {
  it("renders rows", () => {
    render(<OperationalDataTable rows={ROWS} columns={COLUMNS} getRowId={(r) => r.id} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders empty state", () => {
    render(<OperationalDataTable rows={[]} columns={COLUMNS} getRowId={(r) => r.id} emptyTitle="Nada aqui" />);
    expect(screen.getByText("Nada aqui")).toBeInTheDocument();
  });

  it("renders loading state", () => {
    const { container } = render(
      <OperationalDataTable rows={[]} columns={COLUMNS} getRowId={(r) => r.id} isLoading />,
    );
    expect(container.querySelector("[aria-busy]")).toBeTruthy();
  });

  it("renders error state", () => {
    render(<OperationalDataTable rows={[]} columns={COLUMNS} getRowId={(r) => r.id} error={new Error("boom")} />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("search debounces onChange", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <OperationalDataTable
        rows={ROWS}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        search={{ value: "", onChange, placeholder: "Buscar" }}
      />,
    );
    const input = screen.getByPlaceholderText("Buscar");
    fireEvent.change(input, { target: { value: "alp" } });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(onChange).toHaveBeenCalledWith("alp");
    vi.useRealTimers();
  });

  it("row click invokes callback", () => {
    const onRowClick = vi.fn();
    render(
      <OperationalDataTable rows={ROWS} columns={COLUMNS} getRowId={(r) => r.id} onRowClick={onRowClick} />,
    );
    fireEvent.click(screen.getByText("Alpha"));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it("refresh button calls onRefresh", async () => {
    const onRefresh = vi.fn();
    render(
      <OperationalDataTable
        rows={ROWS}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Atualizar/ }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });
});
