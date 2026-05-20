import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpcMock = vi.fn();

function makeQuery(result: { data: unknown; error: null | { message: string } } = { data: [], error: null }) {
  const q: Record<string, unknown> = {
    then: (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF),
  };
  ["select","insert","update","upsert","delete","eq","neq","in","gt","gte","lt","lte","is","not","or","order","limit","maybeSingle","single"]
    .forEach((m) => { q[m] = vi.fn(() => q); });
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  q.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return q;
}

const routeRow = {
  id: "r-1",
  route_date: "2026-05-20",
  state: "planned",
  capacity_status: "ok",
  driver_id: "Driver A",
  delivery_zones: { name: "Zona Norte", color: "#000", zip_from: "1000", zip_to: "1999" },
  vehicles: { name: "Carrinha 1", license_plate: "AA-00-AA", stock_location_id: null },
  loading_docks: { name: "Cais 1" },
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: (table: string) => {
      if (table === "delivery_routes") {
        const q = makeQuery();
        q.maybeSingle = vi.fn(() => Promise.resolve({ data: routeRow, error: null }));
        return q;
      }
      return makeQuery();
    },
    channel: () => ({ on: function (this: unknown) { return this; }, subscribe: () => ({}) }),
    removeChannel: vi.fn(),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign((m: string) => m, {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("../../components/RouteProgress", () => ({ RouteProgress: () => <div data-testid="progress" /> }));
vi.mock("../../components/RouteCapacityCard", () => ({ RouteCapacityCard: () => <div data-testid="capacity" /> }));
vi.mock("../../components/RouteManifestTable", () => ({ RouteManifestTable: () => <div data-testid="manifest" /> }));
vi.mock("../../components/RouteDockSection", () => ({ RouteDockSection: () => <div data-testid="dock" /> }));
vi.mock("../../components/DeliverOrderDialog", () => ({ DeliverOrderDialog: () => null }));
vi.mock("../../components/ReturnPackageDialog", () => ({ ReturnPackageDialog: () => null }));
vi.mock("@/modules/m5/components/CashClosureCard", () => ({ CashClosureCard: () => <div data-testid="cash" /> }));
vi.mock("@/modules/m5/components/RescheduleDialog", () => ({ RescheduleDialog: () => null }));

import RouteDetail from "../RouteDetail";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/routes/r-1"]}>
        <Routes>
          <Route path="/routes/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<RouteDetail />, { wrapper: Wrapper });
}

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe("RouteDetail (F22-R5)", () => {
  it("renders EntityHeader with route status badge and metadata", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Zona Norte/)).toBeInTheDocument());
    expect(screen.getByText("Planeada")).toBeInTheDocument(); // delivery_route status
    expect(screen.getByText(/Carrinha 1/)).toBeInTheDocument();
    expect(screen.getByText(/Cais 1/)).toBeInTheDocument();
  });

  it("renders SummaryCards and key sections", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Entregas")).toBeInTheDocument());
    expect(screen.getByText("Colis")).toBeInTheDocument();
    expect(screen.getByText("Capacidade")).toBeInTheDocument();
    expect(screen.getByText("Verificação")).toBeInTheDocument();
    expect(screen.getByTestId("progress")).toBeInTheDocument();
    expect(screen.getByTestId("manifest")).toBeInTheDocument();
    expect(screen.getByTestId("cash")).toBeInTheDocument();
  });

  it("shows the operational action toolbar", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Mover p\/ cais/)).toBeInTheDocument());
    expect(screen.getByText(/Carregar viatura/)).toBeInTheDocument();
    expect(screen.getByText(/Verificar carga/)).toBeInTheDocument();
    expect(screen.getByText(/Iniciar rota/)).toBeInTheDocument();
    expect(screen.getByText(/Completar/)).toBeInTheDocument();
    expect(screen.getByText(/Fechar rota/)).toBeInTheDocument();
  });
});
