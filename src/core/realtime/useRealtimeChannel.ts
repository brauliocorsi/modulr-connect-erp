import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RealtimeFilter = {
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  schema?: string;
  table: string;
  filter?: string;
};

export type RealtimeChannelOptions = {
  /** Unique channel name (per-user/per-entity to avoid duplicate subscriptions). */
  channel: string;
  /** Subscriptions registered on this channel. */
  filters: RealtimeFilter[];
  /** Called on every matching change. Debounced via {@link debounceMs}. */
  onChange: (payload: any) => void;
  /** Debounce in ms to coalesce bursts. Default 250. */
  debounceMs?: number;
  /** When false the channel is not created. */
  enabled?: boolean;
};

/**
 * Centralised realtime subscription helper (F26-A).
 *
 * - Guarantees unsubscribe on unmount.
 * - Debounces bursts so handlers can simply invalidate caches.
 * - Silently no-ops if `supabase.channel` is unavailable (tests).
 * - Catches and warns on subscribe errors — never throws into render.
 */
export function useRealtimeChannel({
  channel,
  filters,
  onChange,
  debounceMs = 250,
  enabled = true,
}: RealtimeChannelOptions) {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    const sb: any = supabase;
    if (typeof sb?.channel !== "function") return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastPayload: any = null;
    const fire = () => {
      timer = null;
      try {
        handlerRef.current(lastPayload);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[useRealtimeChannel:${channel}] handler error`, e);
      }
    };
    const schedule = (payload: any) => {
      lastPayload = payload;
      if (timer) return;
      timer = setTimeout(fire, debounceMs);
    };

    let ch: any;
    try {
      ch = sb.channel(channel);
      for (const f of filters) {
        ch = ch.on(
          "postgres_changes",
          { event: f.event ?? "*", schema: f.schema ?? "public", table: f.table, filter: f.filter },
          schedule,
        );
      }
      ch.subscribe?.();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[useRealtimeChannel:${channel}] subscribe failed`, e);
    }

    return () => {
      if (timer) clearTimeout(timer);
      try {
        sb.removeChannel?.(ch);
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, enabled, debounceMs, JSON.stringify(filters)]);
}
