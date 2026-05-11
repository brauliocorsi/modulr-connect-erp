// Helpers to group pickings/moves into sale/purchase chains and order their steps.

export type ChainPicking = {
  id: string;
  name: string;
  state: string;
  scheduled_at?: string | null;
  done_at?: string | null;
  created_at?: string | null;
  origin?: string | null;
  source_location_id?: string | null;
  destination_location_id?: string | null;
  [k: string]: any;
};

const PRIORITY: Record<string, number> = { waiting: 0, draft: 1, ready: 2, done: 3, cancelled: 4 };

/** Order steps of a single chain by physical flow (source -> destination), fallback created_at. */
export function orderChainSteps<T extends ChainPicking>(steps: T[]): T[] {
  if (steps.length <= 1) return [...steps];
  const byCreated = [...steps].sort(
    (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
  );
  const dests = new Set(byCreated.map((s) => s.destination_location_id).filter(Boolean));
  // Find starting node: source is not any other step's destination
  const start = byCreated.find((s) => s.source_location_id && !dests.has(s.source_location_id)) ?? byCreated[0];
  const remaining = new Map(byCreated.map((s) => [s.id, s]));
  const ordered: T[] = [];
  let current: T | undefined = start;
  while (current) {
    ordered.push(current);
    remaining.delete(current.id);
    const next = [...remaining.values()].find((s) => s.source_location_id === current!.destination_location_id);
    current = next;
  }
  // Append any leftovers (cycles/orphans)
  for (const s of remaining.values()) ordered.push(s);
  return ordered;
}

/** Consolidated state of a chain. */
export function consolidatedState(steps: ChainPicking[]): string {
  if (steps.length === 0) return "draft";
  if (steps.every((s) => s.state === "cancelled")) return "cancelled";
  if (steps.every((s) => s.state === "done" || s.state === "cancelled")) return "done";
  const pending = steps.filter((s) => s.state !== "done" && s.state !== "cancelled");
  if (pending.some((s) => s.state === "ready")) return "ready";
  return "waiting";
}

/** Index of the next pending step (1-based), or null when chain is finished. */
export function currentStepIndex(steps: ChainPicking[]): number | null {
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].state !== "done" && steps[i].state !== "cancelled") return i + 1;
  }
  return null;
}

export type Group<T extends ChainPicking> = {
  origin: string;
  steps: T[];
  state: string;
  currentStep: number | null;
  totalSteps: number;
  scheduledAt: string | null;
  doneAt: string | null;
  partner: string | null;
};

/** Group pickings by origin, returning ordered chains + leftover singletons (origin = null). */
export function groupByOrigin<T extends ChainPicking>(rows: T[]): { groups: Group<T>[]; singletons: T[] } {
  const buckets = new Map<string, T[]>();
  const singletons: T[] = [];
  for (const r of rows) {
    if (r.origin) {
      const arr = buckets.get(r.origin) ?? [];
      arr.push(r);
      buckets.set(r.origin, arr);
    } else {
      singletons.push(r);
    }
  }
  const groups: Group<T>[] = [];
  for (const [origin, arr] of buckets.entries()) {
    if (arr.length === 1) {
      singletons.push(arr[0]);
      continue;
    }
    const ordered = orderChainSteps(arr);
    const state = consolidatedState(ordered);
    const currentStep = currentStepIndex(ordered);
    const scheduledAt = ordered.map((s) => s.scheduled_at).filter(Boolean).sort()[0] ?? null;
    const doneAt = ordered.map((s) => s.done_at).filter(Boolean).sort().pop() ?? null;
    const partner = (ordered.find((s: any) => s.partners?.name) as any)?.partners?.name ?? null;
    groups.push({ origin, steps: ordered, state, currentStep, totalSteps: ordered.length, scheduledAt, doneAt, partner });
  }
  // Sort groups by consolidated-state priority then scheduled date desc
  groups.sort((a, b) => {
    const pa = PRIORITY[a.state] ?? 9;
    const pb = PRIORITY[b.state] ?? 9;
    if (pa !== pb) return pa - pb;
    return (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? "");
  });
  return { groups, singletons };
}

/** Persist a per-user UI toggle in localStorage. */
export function readToggle(key: string, def = true): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return def;
    return v === "1";
  } catch {
    return def;
  }
}
export function writeToggle(key: string, val: boolean) {
  try { localStorage.setItem(key, val ? "1" : "0"); } catch {}
}
