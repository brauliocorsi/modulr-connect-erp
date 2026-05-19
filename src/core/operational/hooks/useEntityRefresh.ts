import { useCallback, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

export interface UseEntityRefreshOptions {
  entityType: string;
  entityId: string | null | undefined;
  extraKeys?: QueryKey[];
}

/**
 * Standardised refresh helper for entity detail pages.
 * Invalidates the entity query plus its activity_events / tasks / conversations queries.
 */
export function useEntityRefresh({ entityType, entityId, extraKeys }: UseEntityRefreshOptions) {
  const qc = useQueryClient();
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const refresh = useCallback(async () => {
    if (!entityId) return;
    setIsFetching(true);
    try {
      const keys: QueryKey[] = [
        [entityType, entityId],
        ["activity_events", entityType, entityId],
        ["erp_tasks", entityType, entityId],
        ["conversation_threads", entityType, entityId],
        ["conversation_messages", entityType, entityId],
        ...(extraKeys ?? []),
      ];
      await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
      setLastUpdated(new Date());
    } finally {
      setIsFetching(false);
    }
  }, [qc, entityType, entityId, extraKeys]);

  return { refresh, lastUpdated, isFetching };
}
