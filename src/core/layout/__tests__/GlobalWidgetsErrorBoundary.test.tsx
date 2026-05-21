import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GlobalWidgetsErrorBoundary } from "../GlobalWidgetsErrorBoundary";

function Boom({ msg = "boom" }: { msg?: string }): JSX.Element {
  throw new Error(msg);
}

describe("GlobalWidgetsErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <GlobalWidgetsErrorBoundary name="Test">
        <div data-testid="ok">ok</div>
      </GlobalWidgetsErrorBoundary>,
    );
    expect(screen.getByTestId("ok")).toBeInTheDocument();
  });

  it("hides the widget and does not propagate when child throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <div>
        <span data-testid="critical">critical-ui</span>
        <GlobalWidgetsErrorBoundary name="ChatDock">
          <Boom />
        </GlobalWidgetsErrorBoundary>
      </div>,
    );

    // Critical surrounding UI still rendered → isolation holds.
    expect(screen.getByTestId("critical")).toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
    const firstArg = warn.mock.calls[0]?.[0] as string;
    expect(firstArg).toContain("ChatDock");

    warn.mockRestore();
    err.mockRestore();
  });

  it("renders a custom fallback when provided", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <GlobalWidgetsErrorBoundary
        name="Bell"
        fallback={<span data-testid="fallback">offline</span>}
      >
        <Boom />
      </GlobalWidgetsErrorBoundary>,
    );
    expect(screen.getByTestId("fallback")).toBeInTheDocument();

    warn.mockRestore();
    err.mockRestore();
  });

  it("isolates sibling widgets from each other", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <div>
        <GlobalWidgetsErrorBoundary name="A">
          <Boom />
        </GlobalWidgetsErrorBoundary>
        <GlobalWidgetsErrorBoundary name="B">
          <div data-testid="sibling">still here</div>
        </GlobalWidgetsErrorBoundary>
        <main data-testid="page">OrderForm / PickingScan / Cashbox</main>
      </div>,
    );

    expect(screen.getByTestId("sibling")).toBeInTheDocument();
    expect(screen.getByTestId("page")).toBeInTheDocument();

    warn.mockRestore();
    err.mockRestore();
  });
});
