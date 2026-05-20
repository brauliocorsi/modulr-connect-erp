import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const productRow = {
  id: "p1",
  name: "Sofá Lisboa",
  internal_ref: "SOF-001",
  barcode: "1234567890123",
  type: "storable",
  active: true,
  can_be_sold: true,
  can_be_purchased: true,
  can_be_manufactured: true,
  requires_bom: true,
  package_tracking_enabled: true,
  weight: 25,
  volume: 0.4,
  list_price: 999,
  standard_cost: 400,
  category_id: null,
  updated_at: new Date().toISOString(),
};

function makeQuery(table: string) {
  const q: Record<string, unknown> = {
    then: (onF: (v: unknown) => unknown) => {
      const counts: Record<string, number> = {
        product_variants: 4,
        boms: 1,
        product_packages: 2,
      };
      return Promise.resolve({ count: counts[table] ?? 0, data: [], error: null }).then(onF);
    },
  };
  ["select","insert","update","upsert","delete","eq","neq","in","gt","gte","lt","lte","is","not","or","order","limit"]
    .forEach((m) => { q[m] = vi.fn(() => q); });
  q.maybeSingle = vi.fn(() =>
    table === "products"
      ? Promise.resolve({ data: productRow, error: null })
      : Promise.resolve({ data: null, error: null })
  );
  q.single = vi.fn(() => Promise.resolve({ data: productRow, error: null }));
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: (t: string) => makeQuery(t),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
    channel: () => ({ on() { return this; }, subscribe: () => ({}) }),
    removeChannel: vi.fn(),
    storage: { from: () => ({ upload: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  },
}));

vi.mock("../components/TagPicker", () => ({ TagPicker: () => <div data-testid="tag-picker" /> }));
vi.mock("../tabs/SuppliersTab", () => ({ SuppliersTab: () => <div /> }));
vi.mock("../tabs/VariantsTab", () => ({ VariantsTab: () => <div /> }));
vi.mock("../tabs/BomTab", () => ({ BomTab: () => <div /> }));
vi.mock("../tabs/StockTab", () => ({ StockTab: () => <div /> }));
vi.mock("../tabs/WooTab", () => ({ WooTab: () => <div /> }));
vi.mock("../tabs/ReorderingTab", () => ({ ReorderingTab: () => <div /> }));
vi.mock("../tabs/PackagesTab", () => ({ PackagesTab: () => <div /> }));
vi.mock("../tabs/PackageTrackingToggle", () => ({ PackageTrackingToggle: () => <div /> }));
vi.mock("../tabs/OperationalConfigTab", () => ({ OperationalConfigTab: () => <div /> }));
vi.mock("@/core/activities/RecordSidebar", () => ({ RecordSidebar: () => <div /> }));

import ProductForm from "@/modules/products/pages/ProductForm";

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/products/p1"]}>
        <Routes>
          <Route path="/products/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ProductForm />, { wrapper: Wrapper });
}

const waitForLoaded = () =>
  waitFor(() => expect(screen.getAllByText("Sofá Lisboa").length).toBeGreaterThan(0));

describe("ProductForm (F22-V2 visual remodel)", () => {
  it("renders EntityHeader title, SKU and EAN in subtitle", async () => {
    renderForm();
    await waitForLoaded();
    expect(screen.getByText(/SOF-001/)).toBeInTheDocument();
    expect(screen.getByText(/1234567890123/)).toBeInTheDocument();
  });

  it("renders main capability flag badges", async () => {
    renderForm();
    await waitForLoaded();
    expect(screen.getByText("Vendável")).toBeInTheDocument();
    expect(screen.getByText("Comprável")).toBeInTheDocument();
    expect(screen.getByText("Fabricável")).toBeInTheDocument();
    expect(screen.getAllByText("Requer BOM").length).toBeGreaterThan(0);
    expect(screen.getByText("Rastreio colis")).toBeInTheDocument();
  });

  it("renders summary cards: Variantes, BOM, Colis, Peso/Volume, Abastecimento", async () => {
    renderForm();
    await waitForLoaded();
    expect(screen.getByText("BOM")).toBeInTheDocument();
    expect(screen.getByText("Peso / Volume")).toBeInTheDocument();
    expect(screen.getByText("Abastecimento")).toBeInTheDocument();
    expect(screen.getByText(/Compra \+ Fabrica/)).toBeInTheDocument();
  });

  it("shows tab counters when counts are available", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByText(/Variantes \(4\)/)).toBeInTheDocument());
    expect(screen.getByText(/BOM\/Kit \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Colis \(2\)/)).toBeInTheDocument();
  });

  it("renders Salvar primary action", async () => {
    renderForm();
    await waitForLoaded();
    expect(screen.getByRole("button", { name: /Salvar/ })).toBeInTheDocument();
  });
});
