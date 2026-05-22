import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const sample = [
  { id: "c1", code: "CC01", name: "Loja Centro", parent_id: null, active: true },
  { id: "c2", code: "CC02", name: "Loja Sul", parent_id: null, active: true },
  { id: "c3", code: "CC03", name: "Arquivado", parent_id: null, active: false },
];

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(() => Promise.resolve({ data: { ok: true }, error: null })),
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder: any = {
    select: () => builder,
    order: () => Promise.resolve({ data: sample, error: null }),
  };
  return {
    supabase: {
      from: () => builder,
      rpc: rpcMock,
    },
  };
});

import CostCentersPage from "@/modules/finance/pages/CostCentersPage";

const renderPage = () => render(<MemoryRouter><CostCentersPage /></MemoryRouter>);

describe("CostCentersPage (F28-FIN B.2)", () => {
  beforeEach(() => rpcMock.mockClear());

  it("renderiza lista de centros de custo", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("CC01")).toBeInTheDocument());
    expect(screen.getByText("Loja Centro")).toBeInTheDocument();
    expect(screen.getByText("CC02")).toBeInTheDocument();
  });

  it("search filtra por código/nome", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("CC01")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Procurar/i), { target: { value: "Sul" } });
    await waitFor(() => {
      expect(screen.getByText("Loja Sul")).toBeInTheDocument();
      expect(screen.queryByText("Loja Centro")).not.toBeInTheDocument();
    });
  });

  it("criar chama cost_center_upsert sem id", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("CC01")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Novo/i }));
    const dialog = await screen.findByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "CC99" } });
    fireEvent.change(inputs[1], { target: { value: "Novo CC" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar/i }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith(
        "cost_center_upsert",
        expect.objectContaining({
          _payload: expect.objectContaining({ code: "CC99", name: "Novo CC", id: null }),
        }),
      );
    });
  });

  it("editar chama cost_center_upsert com id existente", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("CC01")).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle("Editar")[0]);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /Guardar/i }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith(
        "cost_center_upsert",
        expect.objectContaining({ _payload: expect.objectContaining({ id: "c1" }) }),
      );
    });
  });

  it("arquivar chama cost_center_archive", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("CC01")).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle("Arquivar")[0]);
    fireEvent.click(await screen.findByRole("button", { name: /^Arquivar$/i }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("cost_center_archive", { _id: "c1" });
    });
  });
});
