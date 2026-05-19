import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OperationalStatusBadge } from "../OperationalStatusBadge";

describe("OperationalStatusBadge", () => {
  it("translates known sale statuses", () => {
    render(<OperationalStatusBadge domain="sale" status="confirmed" />);
    expect(screen.getByText("Confirmado")).toBeInTheDocument();
  });
  it("translates ticket linked_to_service_case", () => {
    render(<OperationalStatusBadge domain="ticket" status="linked_to_service_case" />);
    expect(screen.getByText("Ligado à assistência")).toBeInTheDocument();
  });
  it("translates service in_repair", () => {
    render(<OperationalStatusBadge domain="service" status="in_repair" />);
    expect(screen.getByText("Em reparação")).toBeInTheDocument();
  });
  it("translates finance pending_confirmation", () => {
    render(<OperationalStatusBadge domain="finance" status="pending_confirmation" />);
    expect(screen.getByText("Aguarda confirmação")).toBeInTheDocument();
  });
  it("falls back to raw for unknown status", () => {
    render(<OperationalStatusBadge domain="sale" status="weird_thing" />);
    expect(screen.getByText("weird_thing")).toBeInTheDocument();
  });
  it("renders nothing when no status", () => {
    const { container } = render(<OperationalStatusBadge domain="sale" status={null} />);
    expect(container.textContent).toBe("");
  });
});
