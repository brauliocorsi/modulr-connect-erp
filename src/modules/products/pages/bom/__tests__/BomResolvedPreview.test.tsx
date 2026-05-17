import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Mocks ---
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => rpcMock(...args),
    from: (...args: any[]) => fromMock(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { BomResolvedPreview } from "../BomResolvedPreview";

const PRODUCT_ID = "prod-1";
const BOM_ID = "bom-1";

const previewResult = {
  bom_id: BOM_ID,
  parent_chain: [BOM_ID],
  lines: [
    {
      component_product_id: "comp-1",
      qty_required: 2,
      formula_used: "width_cm/100",
      source_line_id: "line-parent-1",
      inheritance_action: "inherited",
      is_optional: false,
      uom_id: null,
      rounding_method: "exact",
    },
  ],
  outputs: [
    {
      output_type: "main",
      product_id: PRODUCT_ID,
      qty_expected: 1,
      cost_allocation_percent: 100,
      stockable: true,
      condition: null,
    },
  ],
  blockers: [{ code: "MISSING_X" }],
  warnings: [{ code: "ROUNDING_APPLIED" }],
};

function setupFromMock() {
  // products + variants selects used by useQuery
  fromMock.mockImplementation((table: string) => {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      order: () => Promise.resolve({ data: [], error: null }),
      then: (cb: any) => cb({ data: [], error: null }),
    };
    if (table === "products") {
      return {
        select: () => Promise.resolve({ data: [{ id: "comp-1", name: "Componente 1" }], error: null }),
      };
    }
    if (table === "product_variants") {
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    }
    return builder;
  });
}

function renderUI() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BomResolvedPreview bomId={BOM_ID} productId={PRODUCT_ID} />
    </QueryClientProvider>,
  );
}

async function openAndCompute() {
  fireEvent.click(screen.getByRole("button", { name: /Preview BOM Resolvida/i }));
  await screen.findByText(/Preview da BOM Resolvida/i);
  fireEvent.click(screen.getByRole("button", { name: /Calcular Preview/i }));
}

describe("BomResolvedPreview", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    setupFromMock();
  });

  it("renderiza o botão de preview", () => {
    renderUI();
    expect(
      screen.getByRole("button", { name: /Preview BOM Resolvida/i }),
    ).toBeInTheDocument();
  });

  it("chama bom_preview_resolved ao calcular e exibe componentes, outputs, blockers e warnings", async () => {
    rpcMock.mockResolvedValueOnce({ data: previewResult, error: null });
    renderUI();
    await openAndCompute();

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith(
        "bom_preview_resolved",
        expect.objectContaining({
          _bom_id: BOM_ID,
          _product_id: PRODUCT_ID,
        }),
      );
    });

    expect(await screen.findByText("Componente 1")).toBeInTheDocument();
    expect(screen.getByText(/Componentes Resolvidos/)).toBeInTheDocument();
    expect(screen.getByText(/Outputs Resolvidos/)).toBeInTheDocument();
    expect(screen.getByText(/Blockers/)).toBeInTheDocument();
    expect(screen.getByText(/Warnings/)).toBeInTheDocument();
    expect(screen.getByText(/cost alloc: 100\.00%/)).toBeInTheDocument();
  });

  it("Override chama bom_upsert_line com parent_bom_line_id e inheritance_action=override", async () => {
    rpcMock.mockResolvedValueOnce({ data: previewResult, error: null });
    renderUI();
    await openAndCompute();
    await screen.findByText("Componente 1");

    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    rpcMock.mockResolvedValueOnce({ data: previewResult, error: null });

    fireEvent.click(screen.getByRole("button", { name: /Override/i }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith(
        "bom_upsert_line",
        expect.objectContaining({
          p_bom_id: BOM_ID,
          p_parent_bom_line_id: "line-parent-1",
          p_inheritance_action: "override",
        }),
      );
    });
  });

  it("Remove chama bom_upsert_line com parent_bom_line_id e inheritance_action=remove", async () => {
    rpcMock.mockResolvedValueOnce({ data: previewResult, error: null });
    renderUI();
    await openAndCompute();
    await screen.findByText("Componente 1");

    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    rpcMock.mockResolvedValueOnce({ data: previewResult, error: null });

    fireEvent.click(screen.getByRole("button", { name: /Remove/i }));
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith(
        "bom_upsert_line",
        expect.objectContaining({
          p_bom_id: BOM_ID,
          p_parent_bom_line_id: "line-parent-1",
          p_inheritance_action: "remove",
        }),
      );
    });
  });

  it("preview não chama nenhuma RPC de criação de MO, purchase_need ou stock", async () => {
    rpcMock.mockResolvedValueOnce({ data: previewResult, error: null });
    renderUI();
    await openAndCompute();
    await screen.findByText("Componente 1");

    const forbidden = [
      "mfg_create_mo_for_line",
      "mfg_create_manual_mo",
      "close_mo",
      "create_purchase_need",
      "stock_move_create",
      "create_stock_package",
    ];
    const calls = rpcMock.mock.calls.map((c) => c[0]);
    for (const name of forbidden) {
      expect(calls).not.toContain(name);
    }
    // Only bom_preview_resolved should have been called
    expect(calls).toEqual(["bom_preview_resolved"]);
  });
});
