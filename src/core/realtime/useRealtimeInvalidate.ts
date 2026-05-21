import { useCallback } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRealtimeChannel, type RealtimeFilter } from "./useRealtimeChannel";

/**
 * Subscribe to realtime changes and invalidate one or more React Query keys.
 * Targeted invalidation — never a global refetch storm.
 */
export function useRealtimeInvalidate(opts: {
  channel: string;
  filters: RealtimeFilter[];
  queryKeys: QueryKey[];
  enabled?: boolean;
  debounceMs?: number;
}) {
  const qc = useQueryClient();
  const onChange = useCallback(() => {
    for (const k of opts.queryKeys) {
      qc.invalidateQueries({ queryKey: k });
    }
  }, [qc, opts.queryKeys]);
  useRealtimeChannel({
    channel: opts.channel,
    filters: opts.filters,
    onChange,
    enabled: opts.enabled,
    debounceMs: opts.debounceMs,
  });
}
