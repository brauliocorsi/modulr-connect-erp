import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import GlobalSidebar, { __SIDEBAR_GROUPS_FOR_TEST } from "../GlobalSidebar";

function setup(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <GlobalSidebar />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("GlobalSidebar", () => {
  it("renders all main groups", () => {
    setup("/");
    for (const g of __SIDEBAR_GROUPS_FOR_TEST) {
      expect(screen.getByTestId(`sidebar-group-${g.id}`)).toBeInTheDocument();
    }
  });

  it("Comercial group exposes Vendas, Compras Necessidades, Produção Ordens, Produtos", () => {
    setup("/");
    fireEvent.click(screen.getByTestId("sidebar-group-comercial"));
    fireEvent.click(screen.getByTestId("sidebar-group-produtos"));
    fireEvent.click(screen.getByTestId("sidebar-group-compras"));
    fireEvent.click(screen.getByTestId("sidebar-group-producao"));
    expect(screen.getByRole("link", { name: "Pedidos" })).toHaveAttribute("href", "/sales/orders");
    expect(screen.getByRole("link", { name: "Produtos" })).toHaveAttribute("href", "/products");
    expect(screen.getByRole("link", { name: "Necessidades" })).toHaveAttribute("href", "/purchase/needs");
    expect(screen.getByRole("link", { name: "Ordens de Fabricação" })).toHaveAttribute("href", "/manufacturing/orders");
  });

  it("Financeiro group exposes Caixa, Créditos, A Receber, Contas a Pagar", () => {
    setup("/finance");
    expect(screen.getByRole("link", { name: "Caixa" })).toHaveAttribute("href", "/cashbox");
    expect(screen.getByRole("link", { name: "Créditos de Cliente" })).toHaveAttribute("href", "/finance/credits");
    expect(screen.getByRole("link", { name: "A Receber" })).toHaveAttribute("href", "/finance/receivables");
    expect(screen.getAllByRole("link", { name: "Contas a Pagar" })[0]).toHaveAttribute("href", "/finance/payables");
  });

  it("Helpdesk group exposes Tickets", () => {
    setup("/helpdesk/tickets");
    expect(screen.getByRole("link", { name: "Tickets" })).toHaveAttribute("href", "/helpdesk/tickets");
  });

  it("auto-expands group containing the active route", () => {
    setup("/sales/orders");
    expect(screen.getByRole("link", { name: "Pedidos" })).toBeVisible();
  });

  it("renders coming-soon items as disabled (non-link)", () => {
    setup("/");
    fireEvent.click(screen.getByTestId("sidebar-group-assistencia"));
    expect(screen.getByTestId("sidebar-item-disabled-Reparações")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reparações" })).toBeNull();
  });

  it("search filter narrows visible items", () => {
    setup("/");
    const input = screen.getByPlaceholderText("Buscar no menu…");
    fireEvent.change(input, { target: { value: "kardex" } });
    expect(screen.getByRole("link", { name: "Kardex" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Pedidos" })).toBeNull();
  });
});
