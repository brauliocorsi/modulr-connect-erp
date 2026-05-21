import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useRealtimeChannel } from "../useRealtimeChannel";

const onSpy = vi.fn();
const subscribeSpy = vi.fn();
const removeSpy = vi.fn();
const channelSpy = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {
    on: (...args: any[]) => {
      onSpy(...args);
      return chain;
    },
    subscribe: (...args: any[]) => {
      subscribeSpy(...args);
      return chain;
    },
  };
  return {
    supabase: {
      channel: (name: string) => {
        channelSpy(name);
        return chain;
      },
      removeChannel: (...args: any[]) => removeSpy(...args),
    },
  };
});

function Harness({ enabled = true, handler }: { enabled?: boolean; handler: () => void }) {
  useRealtimeChannel({
    channel: "test-ch",
    filters: [{ table: "x" }, { table: "y", event: "INSERT" }],
    onChange: handler,
    debounceMs: 10,
    enabled,
  });
  return null;
}

describe("useRealtimeChannel", () => {
  beforeEach(() => {
    onSpy.mockClear();
    subscribeSpy.mockClear();
    removeSpy.mockClear();
    channelSpy.mockClear();
  });

  it("subscribes to all provided filters and unsubscribes on unmount", () => {
    const handler = vi.fn();
    const { unmount } = render(<Harness handler={handler} />);
    expect(channelSpy).toHaveBeenCalledWith("test-ch");
    expect(onSpy).toHaveBeenCalledTimes(2);
    expect(subscribeSpy).toHaveBeenCalled();
    unmount();
    expect(removeSpy).toHaveBeenCalled();
  });

  it("does not subscribe when disabled", () => {
    const handler = vi.fn();
    render(<Harness handler={handler} enabled={false} />);
    expect(channelSpy).not.toHaveBeenCalled();
  });

  it("debounces handler invocations", async () => {
    const handler = vi.fn();
    render(<Harness handler={handler} />);
    // Pull the schedule callback registered with .on(...) and fire bursts.
    const cb = onSpy.mock.calls[0][2] as (p: any) => void;
    await act(async () => {
      cb({ a: 1 });
      cb({ a: 2 });
      cb({ a: 3 });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
