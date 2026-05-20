import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const rpcMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) },
}));

const tplRow = {
  id: "t1",
  product_id: "p1",
  name: "Colis 1",
  description: null,
  package_sequence: 1,
  package_total: 1,
  package_group: null,
  default_length_cm: 10,
  default_width_cm: 10,
  default_height_cm: 10,
  default_volume_m3: 0.001,
  default_weight_kg: 2,
  default_assembly_minutes: null,
  stackable: false,
  fragile: false,
  requires_flat_transport: false,
  requires_assembly: false,
  is_required: true,
  barcode_pattern: null,
  active: true,
};

function makeQuery() {
  const q: Record<string, unknown> = {
    then: (onF: (v: unknown) => unknown) =>
      Promise.resolve({ data: [tplRow], error: null }).then(onF),
  };
  ["select", "eq", "order"].forEach((m) => { q[m] = vi.fn(() => q); });
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => makeQuery(),
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));

import { PackagesTab } from "../tabs/PackagesTab";

beforeEach(() => {
  rpcMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  rpcMock.mockResolvedValue({ data: "ok", error: null });
  // confirm dialogs default-accept
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("PackagesTab", () => {
  it("renders templates", async () => {
    render(<PackagesTab productId="p1" />);
    await waitFor(() => expect(screen.getByDisplayValue("Colis 1")).toBeInTheDocument());
  });

  it("calls upsert RPC on add", async () => {
    render(<PackagesTab productId="p1" />);
    await screen.findByDisplayValue("Colis 1");
    fireEvent.click(screen.getByText(/Adicionar template/));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "product_package_template_upsert",
        expect.objectContaining({ _template_id: null, _product_id: "p1" }),
      ),
    );
  });

  it("calls delete RPC on remove", async () => {
    render(<PackagesTab productId="p1" />);
    await screen.findByDisplayValue("Colis 1");
    const trashBtns = document.querySelectorAll("button svg.lucide-trash2");
    fireEvent.click(trashBtns[0].closest("button")!);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("product_package_template_delete", { _template_id: "t1" }),
    );
  });

  it("shows friendly toast when delete blocked", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "template_in_use" } });
    render(<PackagesTab productId="p1" />);
    await screen.findByDisplayValue("Colis 1");
    const trashBtns = document.querySelectorAll("button svg.lucide-trash2");
    fireEvent.click(trashBtns[0].closest("button")!);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining("já gerou colis")));
  });
});
