import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OperationalActionBar, type OperationalAction } from "../OperationalActionBar";

describe("OperationalActionBar", () => {
  it("invokes onClick for normal actions", () => {
    const fn = vi.fn();
    const actions: OperationalAction[] = [{ key: "a", label: "Ir", onClick: fn }];
    render(<OperationalActionBar actions={actions} />);
    fireEvent.click(screen.getByRole("button", { name: "Ir" }));
    expect(fn).toHaveBeenCalled();
  });

  it("disables button and exposes disabledReason", async () => {
    const actions: OperationalAction[] = [{ key: "a", label: "Bloqueado", onClick: vi.fn(), disabled: true, disabledReason: "Motivo claro" }];
    render(<OperationalActionBar actions={actions} />);
    const btn = screen.getByRole("button", { name: "Bloqueado" });
    expect(btn).toBeDisabled();
    // tooltip wrapper present
    expect(btn.closest("span")).toBeTruthy();
  });

  it("loading isolates button", () => {
    const actions: OperationalAction[] = [
      { key: "a", label: "Ação A", onClick: vi.fn(), loading: true },
      { key: "b", label: "Ação B", onClick: vi.fn() },
    ];
    render(<OperationalActionBar actions={actions} />);
    expect(screen.getByRole("button", { name: /Ação A/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ação B" })).not.toBeDisabled();
  });

  it("destructive action opens confirm dialog", async () => {
    const fn = vi.fn();
    const actions: OperationalAction[] = [{
      key: "del", label: "Apagar", onClick: fn, destructive: true,
      confirm: { title: "Apagar mesmo?", confirmLabel: "Sim" },
    }];
    render(<OperationalActionBar actions={actions} />);
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
    await waitFor(() => expect(screen.getByText("Apagar mesmo?")).toBeInTheDocument());
    expect(fn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sim" }));
    await waitFor(() => expect(fn).toHaveBeenCalled());
  });
});
