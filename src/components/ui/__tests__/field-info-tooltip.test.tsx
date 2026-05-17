import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FieldInfoTooltip } from "@/components/ui/field-info-tooltip";

const open = (label = /Ajuda:/) => {
  fireEvent.click(screen.getByRole("button", { name: label }));
};

describe("FieldInfoTooltip", () => {
  it("renderiza ícone com label acessível baseado no título", () => {
    render(<FieldInfoTooltip title="Stock mínimo" description="Quantidade mínima em armazém." />);
    expect(screen.getByRole("button", { name: "Ajuda: Stock mínimo" })).toBeInTheDocument();
  });

  it("abre popover com título e descrição ao clicar", () => {
    render(
      <FieldInfoTooltip
        title="package_tracking_enabled"
        description="Ativa o controlo físico por colis."
      />,
    );
    open();
    expect(screen.getByText("package_tracking_enabled")).toBeInTheDocument();
    expect(screen.getByText(/controlo físico por colis/i)).toBeInTheDocument();
  });

  it("mostra exemplo quando fornecido", () => {
    render(
      <FieldInfoTooltip
        title="qty_formula"
        description="Fórmula para calcular a quantidade."
        example="base * 1.05"
      />,
    );
    open();
    expect(screen.getByText(/Exemplo:/)).toBeInTheDocument();
    expect(screen.getByText("base * 1.05")).toBeInTheDocument();
  });

  it("mostra warning quando fornecido", () => {
    render(
      <FieldInfoTooltip
        title="waste"
        description="Perda/resíduo."
        warning="Não entra em stock disponível."
      />,
    );
    open();
    expect(screen.getByText("Não entra em stock disponível.")).toBeInTheDocument();
  });

  it("aceita aria-label customizado", () => {
    render(
      <FieldInfoTooltip
        title="x"
        description="d"
        ariaLabel="Ajuda do campo X"
      />,
    );
    expect(screen.getByRole("button", { name: "Ajuda do campo X" })).toBeInTheDocument();
  });
});
