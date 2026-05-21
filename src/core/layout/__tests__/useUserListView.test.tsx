import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUserListView } from "../useUserListView";

vi.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }),
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }),
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const defaults = {
  columns: [
    { key: "a", visible: true, order: 0 },
    { key: "b", visible: true, order: 1 },
  ],
  filters: {},
  sort: { key: "created_at", asc: false },
};

describe("useUserListView", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads defaults when no preference saved", () => {
    const { result } = renderHook(() => useUserListView("test.view", defaults), { wrapper });
    expect(result.current.state.columns).toEqual(defaults.columns);
  });

  it("persists updates to localStorage", async () => {
    const { result } = renderHook(() => useUserListView("test.view", defaults), { wrapper });
    act(() => {
      result.current.update({ sort: { key: "name", asc: true } });
    });
    await waitFor(() => {
      const raw = localStorage.getItem("list-view:test.view");
      expect(raw).toContain("name");
    });
  });

  it("falls back to defaults on corrupted localStorage", () => {
    localStorage.setItem("list-view:test.view", "{not json");
    const { result } = renderHook(() => useUserListView("test.view", defaults), { wrapper });
    expect(result.current.state.columns).toEqual(defaults.columns);
  });

  it("resetToDefaults clears local prefs", () => {
    localStorage.setItem("list-view:test.view", JSON.stringify({ ...defaults, sort: { key: "x", asc: true } }));
    const { result } = renderHook(() => useUserListView("test.view", defaults), { wrapper });
    act(() => result.current.resetToDefaults());
    expect(localStorage.getItem("list-view:test.view")).toBeNull();
  });
});
