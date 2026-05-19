import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EntityHeader } from "../EntityHeader";

function renderHeader(props: Partial<React.ComponentProps<typeof EntityHeader>> = {}) {
  return render(
    <MemoryRouter>
      <EntityHeader title="Pedido 123" {...props} />
    </MemoryRouter>,
  );
}

describe("EntityHeader", () => {
  it("renders title, status badges, metadata", () => {
    renderHeader({
      statusBadges: <span data-testid="badges">badge</span>,
      metadata: [{ label: "Cliente", value: "ACME" }],
    });
    expect(screen.getByText("Pedido 123")).toBeInTheDocument();
    expect(screen.getByTestId("badges")).toBeInTheDocument();
    expect(screen.getByText("Cliente")).toBeInTheDocument();
    expect(screen.getByText("ACME")).toBeInTheDocument();
  });

  it("calls refresh callback", () => {
    const onRefresh = vi.fn();
    renderHeader({ onRefresh });
    fireEvent.click(screen.getByRole("button", { name: /Atualizar/ }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("renders primary actions", () => {
    const fn = vi.fn();
    renderHeader({ primaryActions: [{ key: "a", label: "Confirmar", onClick: fn }] });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(fn).toHaveBeenCalled();
  });
});
