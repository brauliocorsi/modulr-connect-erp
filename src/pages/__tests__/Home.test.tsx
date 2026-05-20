import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

function makeQuery() {
  const q: Record<string, unknown> = {
    then: (onF: (v: unknown) => unknown) => Promise.resolve({ count: 3, data: [], error: null }).then(onF),
  };
  ["select","insert","update","upsert","delete","eq","neq","in","gt","gte","lt","lte","is","not","or","order","limit","maybeSingle","single"]
    .forEach((m) => { q[m] = vi.fn(() => q); });
  q.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  q.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: () => makeQuery(),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
    channel: () => ({ on() { return this; }, subscribe: () => ({}) }),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { email: "alice@test.com" }, signOut: vi.fn() }),
}));

vi.mock("@/core/modules/useInstalledModules", () => ({
  useInstalledModules: () => ({ data: { sales: true, purchase: true, manufacturing: true } }),
}));

import Home from "@/pages/Home";

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Home />, { wrapper: Wrapper });
}

beforeEach(() => {});

describe("Home operacional (F22-V1)", () => {
  it("renders greeting with the user name", () => {
    renderHome();
    expect(screen.getByText(/alice/)).toBeInTheDocument();
  });

  it("renders the 8 operational KPI cards", async () => {
    renderHome();
    expect(screen.getByText(/Indicadores operacionais/i)).toBeInTheDocument();
    expect(screen.getByText(/Vendas abertas/i)).toBeInTheDocument();
    expect(screen.getByText(/Prontos p\/ entrega/i)).toBeInTheDocument();
    expect(screen.getByText(/OFs em produção/i)).toBeInTheDocument();
    expect(screen.getByText(/Necessidades pendentes/i)).toBeInTheDocument();
    expect(screen.getByText(/Tickets abertos/i)).toBeInTheDocument();
    expect(screen.getByText(/Assistência aguarda peça/i)).toBeInTheDocument();
    expect(screen.getByText(/Notificações não lidas/i)).toBeInTheDocument();
    expect(screen.getByText(/Tarefas vencidas/i)).toBeInTheDocument();
  });

  it("renders quick access to installed modules", async () => {
    renderHome();
    expect(screen.getByText(/Acesso rápido aos módulos/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Vendas/).length).toBeGreaterThan(0));
  });

  it("KPI cards eventually render a numeric value", async () => {
    renderHome();
    await waitFor(() => {
      // count from mocked query is 3 → at least one card shows 3
      expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    });
  });
});
