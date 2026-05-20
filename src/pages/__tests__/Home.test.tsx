import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

function makeQuery() {
  const q: Record<string, unknown> = {
    then: (onF: (v: unknown) => unknown) =>
      Promise.resolve({ count: 0, data: [], error: null }).then(onF),
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

describe("Home simplificada (F23-A)", () => {
  it("renders greeting with the user name", () => {
    renderHome();
    expect(screen.getByText(/alice/)).toBeInTheDocument();
  });

  it("does NOT render the legacy 'Indicadores operacionais' KPI block", () => {
    renderHome();
    expect(screen.queryByText(/Indicadores operacionais/i)).not.toBeInTheDocument();
  });

  it("renders CTA Indicadores linking to /indicators", () => {
    renderHome();
    const cta = screen.getByTestId("home-cta-indicators");
    expect(cta).toBeInTheDocument();
    expect(cta.getAttribute("href")).toBe("/indicators");
  });

  it("renders Notificações block", async () => {
    renderHome();
    await waitFor(() =>
      expect(screen.getByText(/Notificações/i)).toBeInTheDocument(),
    );
  });

  it("renders Minhas tarefas block", async () => {
    renderHome();
    await waitFor(() =>
      expect(screen.getByText(/Minhas tarefas/i)).toBeInTheDocument(),
    );
  });

  it("renders quick access to installed modules", async () => {
    renderHome();
    expect(screen.getByText(/Acesso rápido aos módulos/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Vendas/).length).toBeGreaterThan(0));
  });
});
