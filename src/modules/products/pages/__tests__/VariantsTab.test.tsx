import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const rpcMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) },
}));

const variantRow = {
  id: "v1",
  sku: "SKU-1",
  barcode: null,
  price_extra: 0,
  active: true,
  weight: null,
  image_url: null,
  product_variant_values: [],
};

function makeQuery(table: string) {
  const q: Record<string, unknown> = {
    then: (onF: (v: unknown) => unknown) =>
      Promise.resolve({
        data: table === "product_variants" ? [variantRow] : [],
        error: null,
      }).then(onF),
  };
  ["select", "eq", "in", "order", "is", "not", "neq"].forEach((m) => {
    q[m] = vi.fn(() => q);
  });
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: { name: "Sofá" }, error: null }));
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => makeQuery(t),
    rpc: (...args: unknown[]) => rpcMock(...args),
    storage: {
      from: () => ({
        upload: vi.fn(async () => ({ error: null })),
        getPublicUrl: () => ({ data: { publicUrl: "http://x/y.jpg" } }),
      }),
    },
  },
}));

import { VariantsTab } from "@/modules/products/pages/tabs/VariantsTab";

beforeEach(() => {
  rpcMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

const waitForVariant = () =>
  waitFor(() => expect(screen.getByDisplayValue("SKU-1")).toBeInTheDocument());

describe("VariantsTab (F22-V2.1 RPC migration)", () => {
  it("edit dispatches product_variant_upsert RPC", async () => {
    rpcMock.mockResolvedValue({ data: "v1", error: null });
    render(<VariantsTab productId="p1" />);
    await waitForVariant();
    const sku = screen.getByDisplayValue("SKU-1");
    fireEvent.change(sku, { target: { value: "SKU-2" } });
    fireEvent.blur(sku);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        "product_variant_upsert",
        expect.objectContaining({
          _variant_id: "v1",
          _product_id: "p1",
          _payload: expect.objectContaining({ sku: "SKU-2" }),
        }),
      ),
    );
  });

  it("remove dispatches product_variant_delete RPC", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    const { container } = render(<VariantsTab productId="p1" />);
    await waitForVariant();
    const buttons = Array.from(container.querySelectorAll("button"));
    const deleteBtn = buttons[buttons.length - 1];
    fireEvent.click(deleteBtn);
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("product_variant_delete", { _variant_id: "v1" }),
    );
  });

  it("delete shows friendly toast when backend blocks (has_stock)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "has_stock" } });
    const { container } = render(<VariantsTab productId="p1" />);
    await waitForVariant();
    const buttons = Array.from(container.querySelectorAll("button"));
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/stock/i)),
    );
  });
});

