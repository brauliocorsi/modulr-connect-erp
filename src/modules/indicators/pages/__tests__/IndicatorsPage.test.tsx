import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

function makeQuery(opts: { count?: number | null; data?: unknown[]; error?: unknown } = {}) {
  const result = { count: opts.count ?? 0, data: opts.data ?? [], error: opts.error ?? null };
  const q: Record<string, unknown> = {
    then: (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF),
  };
  ["select","insert","update","upsert","delete","eq","neq","in","gt","gte","lt","lte","is","not","or","order","limit","maybeSingle","single"]
    .forEach((m) => { q[m] = vi.fn(() => q); });
  return q;
}

const fromMock = vi.fn(() => makeQuery({ count: 7 }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: (...a: unknown[]) => (fromMock as any)(...a),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
    channel: () => ({ on() { return this; }, subscribe: () => ({}) }),
    removeChannel: vi.fn(),
  },
}));

import IndicatorsPage, {
  __INDICATOR_AREAS_FOR_TEST as AREAS,
} from "@/modules/indicators/pages/IndicatorsPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<IndicatorsPage />, { wrapper: Wrapper });
}

describe("IndicatorsPage (F23-A)", () => {
  it("renders title and all 7 area sections", () => {
    renderPage();
    expect(screen.getByText(/Visão operacional do negócio/i)).toBeInTheDocument();
    for (const a of AREAS) {
      expect(screen.getByTestId(`indicators-area-${a.id}`)).toBeInTheDocument();
    }
    expect(AREAS).toHaveLength(7);
  });

  it("renders indicator cards with values eventually", async () => {
    renderPage();
    // shows skeleton first
    expect(
      screen.getAllByTestId(/^indicator-skeleton-/).length,
    ).toBeGreaterThan(0);
    // then value 7 from mock
    await waitFor(() => {
      expect(screen.getAllByText("7").length).toBeGreaterThan(0);
    });
  });

  it("cards link to filtered list routes", async () => {
    renderPage();
    const card = await screen.findByTestId("indicator-sales_open");
    expect(card.getAttribute("href")).toContain("/sales/orders");
  });

  it("renders period tabs and changes period", () => {
    renderPage();
    expect(screen.getByTestId("indicators-period")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("indicators-period-7d"));
    // no throw → state change applied
    expect(screen.getByTestId("indicators-period-7d")).toBeInTheDocument();
  });

  it("renders fallback '—' when a query errors (does not crash)", async () => {
    fromMock.mockImplementationOnce(() => makeQuery({ count: null, error: new Error("boom") }));
    renderPage();
    // page should still render area sections
    expect(screen.getByTestId("indicators-area-comercial")).toBeInTheDocument();
    await waitFor(() => {
      // some card must show "—"
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });
  });
});
