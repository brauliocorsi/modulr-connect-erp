import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import ModuleInnerMenu from "../ModuleInnerMenu";

function setup(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <ModuleInnerMenu />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("ModuleInnerMenu", () => {
  beforeEach(() => localStorage.clear());

  it("renders nothing when not inside a known module", () => {
    const { container } = setup("/unknown-area");
    expect(container.firstChild).toBeNull();
  });

  it("renders module menu when inside a module", () => {
    setup("/finance/receivables");
    expect(screen.getByTestId("module-inner-menu")).toHaveAttribute("data-module", "finance");
    expect(screen.getByRole("link", { name: "A Receber" })).toHaveAttribute("href", "/finance/receivables");
  });

  it("groups items by section", () => {
    setup("/finance");
    expect(screen.getByTestId("module-section-Operações")).toBeInTheDocument();
    expect(screen.getByTestId("module-section-Configuração")).toBeInTheDocument();
  });

  it("highlights active item", () => {
    setup("/finance/payables");
    const link = screen.getAllByRole("link", { name: "Contas a Pagar" })[0];
    expect(link.className).toMatch(/bg-accent/);
  });
});
