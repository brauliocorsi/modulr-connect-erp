// F27-B — Pure frontend helpers for delivery calendar + postal-code suggestions.
// Read-only. No writes, no RPC, no side effects.

export type RouteRow = {
  id: string;
  route_date: string | null;
  state?: string | null;
  zone_id?: string | null;
  vehicle_id?: string | null;
  cap_deliveries?: number | null;
  cap_volume_m3?: number | null;
  cap_assembly_minutes?: number | null;
  current_deliveries?: number | null;
  current_volume_m3?: number | null;
  current_assembly_minutes?: number | null;
  delivery_zones?: { id?: string; name?: string | null; color?: string | null; zip_from?: string | null; zip_to?: string | null } | null;
  vehicles?: { id?: string; name?: string | null; license_plate?: string | null; usable_volume_m3?: number | null; volume_m3?: number | null; assembly_minutes_capacity?: number | null; max_stops?: number | null; max_assembly_minutes?: number | null } | null;
};

export type ScheduleRow = {
  id: string;
  sale_order_id: string | null;
  route_id: string | null;
  scheduled_date: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  status?: string | null;
  partner_id?: string | null;
  fulfillment_type?: string | null;
};

export type SaleOrderRow = {
  id: string;
  name?: string | null;
  partner_id?: string | null;
  commitment_date?: string | null;
  include_assembly?: boolean | null;
  delivery_mode?: string | null;
  /** optional aggregate populated by caller */
  est_volume_m3?: number | null;
  est_assembly_minutes?: number | null;
};

export type SaturationStatus = "green" | "yellow" | "red" | "unknown";

export type DayCapacity = {
  date: string;
  slots_used: number;
  slots_capacity: number | null;
  volume_used_m3: number | null;
  volume_capacity_m3: number | null;
  assembly_minutes_total: number | null;
  assembly_minutes_capacity: number | null;
  saturation_status: SaturationStatus;
};

const sumDefined = (xs: Array<number | null | undefined>) => {
  const filtered = xs.filter((x) => x != null && !Number.isNaN(Number(x))) as number[];
  return filtered.length ? filtered.reduce((a, b) => a + Number(b), 0) : null;
};

const ratio = (used: number | null, cap: number | null): number | null => {
  if (used == null || cap == null || cap <= 0) return null;
  return used / cap;
};

function pickSaturation(ratios: Array<number | null>): SaturationStatus {
  const present = ratios.filter((r): r is number => r != null);
  if (!present.length) return "unknown";
  const max = Math.max(...present);
  if (max >= 0.95) return "red";
  if (max >= 0.75) return "yellow";
  return "green";
}

/**
 * Aggregate per-day capacity. Each input is the set of records for a *single date*.
 * - slots_used comes from delivered+pending schedules
 * - slots_capacity sums cap_deliveries (fallback: vehicles.max_stops)
 * - volume sums per route current_volume_m3 (or — if missing — by SO est_volume_m3)
 * - assembly minutes same logic
 * Missing data yields nulls and surfaces as "—" upstream.
 */
export function calculateDayCapacity(
  date: string,
  dayRoutes: RouteRow[],
  schedules: ScheduleRow[],
  saleOrders: SaleOrderRow[] = []
): DayCapacity {
  const soById = new Map(saleOrders.map((s) => [s.id, s]));
  const slots_used = schedules.filter((s) => s.status !== "cancelled").length;

  const slots_capacity = sumDefined(
    dayRoutes.map((r) => r.cap_deliveries ?? r.vehicles?.max_stops ?? null)
  );

  // Volume — prefer route current, fallback to SO estimates if all current are null.
  const routeVolumeUsed = sumDefined(dayRoutes.map((r) => r.current_volume_m3));
  const soVolumeUsed = sumDefined(
    schedules.map((s) => (s.sale_order_id ? soById.get(s.sale_order_id)?.est_volume_m3 ?? null : null))
  );
  const volume_used_m3 = routeVolumeUsed ?? soVolumeUsed;
  const volume_capacity_m3 = sumDefined(
    dayRoutes.map((r) => r.cap_volume_m3 ?? r.vehicles?.usable_volume_m3 ?? r.vehicles?.volume_m3 ?? null)
  );

  const routeAsmUsed = sumDefined(dayRoutes.map((r) => r.current_assembly_minutes));
  const soAsmUsed = sumDefined(
    schedules.map((s) => (s.sale_order_id ? soById.get(s.sale_order_id)?.est_assembly_minutes ?? null : null))
  );
  const assembly_minutes_total = routeAsmUsed ?? soAsmUsed;
  const assembly_minutes_capacity = sumDefined(
    dayRoutes.map((r) => r.cap_assembly_minutes ?? r.vehicles?.assembly_minutes_capacity ?? r.vehicles?.max_assembly_minutes ?? null)
  );

  const saturation_status = pickSaturation([
    ratio(slots_used, slots_capacity),
    ratio(volume_used_m3, volume_capacity_m3),
    ratio(assembly_minutes_total, assembly_minutes_capacity),
  ]);

  return {
    date,
    slots_used,
    slots_capacity,
    volume_used_m3,
    volume_capacity_m3,
    assembly_minutes_total,
    assembly_minutes_capacity,
    saturation_status,
  };
}

// ── postal code suggestions ─────────────────────────────────────────────

function postalMatchesZone(zip: string, zone?: RouteRow["delivery_zones"]): boolean {
  if (!zone) return false;
  const zf = (zone.zip_from ?? "").replace(/\s/g, "");
  const zt = (zone.zip_to ?? "").replace(/\s/g, "");
  const z = zip.replace(/\s/g, "");
  if (!zf && !zt) return false;
  const lo = zf || zt;
  const hi = zt || zf;
  // Compare lexicographically up to the length of the shorter bound (zone may use prefixes like "4000").
  const norm = (v: string) => v.slice(0, Math.max(lo.length, hi.length));
  const zn = norm(z);
  return zn >= norm(lo) && zn <= norm(hi);
}

export type SuggestedDay = {
  date: string;
  route_id: string;
  zone_name: string;
  reason: string;
  capacity_remaining_m3: number | null;
  saturation_status: SaturationStatus;
  daysFromPreferred: number;
};

const diffDays = (a: string, b: string) => {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  return Math.round((da - db) / 86400000);
};

/**
 * Suggest delivery days given a postal code and a preferred date.
 * Read-only. Uses existing route+zone data.
 * Returns a list ordered by:
 *   1. zone match by postal code
 *   2. capacity remaining
 *   3. proximity to preferred date
 *   4. lowest saturation
 */
export function suggestDeliveryDays(opts: {
  postalCode: string | null | undefined;
  fromDate: string;
  routes: RouteRow[];
  /** optional fallback zone (e.g. SO's delivery zone) */
  fallbackZoneId?: string | null;
  daySaturation?: Map<string, SaturationStatus>;
  limit?: number;
}): SuggestedDay[] {
  const { postalCode, fromDate, routes, fallbackZoneId, daySaturation, limit = 6 } = opts;
  const pc = (postalCode ?? "").trim();
  const candidates = routes
    .filter((r) => !!r.route_date && r.route_date >= fromDate)
    .filter((r) => ["planned", "in_progress", "draft"].includes(r.state ?? "planned"));

  const matched = candidates.filter((r) => {
    if (pc && postalMatchesZone(pc, r.delivery_zones)) return true;
    if (!pc && fallbackZoneId && r.zone_id === fallbackZoneId) return true;
    return false;
  });

  const pool = matched.length ? matched : (fallbackZoneId
    ? candidates.filter((r) => r.zone_id === fallbackZoneId)
    : []);

  if (!pool.length) return [];

  const enriched: SuggestedDay[] = pool.map((r) => {
    const capV = r.cap_volume_m3 ?? r.vehicles?.usable_volume_m3 ?? r.vehicles?.volume_m3 ?? null;
    const usedV = r.current_volume_m3 ?? 0;
    const remaining = capV != null ? Math.max(0, Number(capV) - Number(usedV)) : null;
    const dist = Math.abs(diffDays(r.route_date!, fromDate));
    const sat = daySaturation?.get(r.route_date!) ?? "unknown";
    let reason = "Rota disponível";
    if (pc && postalMatchesZone(pc, r.delivery_zones)) {
      reason = remaining != null
        ? `${r.delivery_zones?.name ?? "Rota"} já planeada · ${remaining.toFixed(1)} m³ livres`
        : `${r.delivery_zones?.name ?? "Rota"} já planeada para o CP`;
    } else if (!pc && fallbackZoneId && r.zone_id === fallbackZoneId) {
      reason = "Zona da encomenda · sem código postal";
    }
    if (dist === 0) reason = `${reason} · data preferida`;
    return {
      date: r.route_date!,
      route_id: r.id,
      zone_name: r.delivery_zones?.name ?? "Rota",
      reason,
      capacity_remaining_m3: remaining,
      saturation_status: sat,
      daysFromPreferred: dist,
    };
  });

  const satRank: Record<SaturationStatus, number> = { green: 0, yellow: 1, unknown: 2, red: 3 };
  enriched.sort((a, b) => {
    // 1. capacity remaining (desc, nulls last)
    const ca = a.capacity_remaining_m3 ?? -1;
    const cb = b.capacity_remaining_m3 ?? -1;
    if (cb !== ca) return cb - ca;
    // 2. proximity
    if (a.daysFromPreferred !== b.daysFromPreferred) return a.daysFromPreferred - b.daysFromPreferred;
    // 3. saturation
    return satRank[a.saturation_status] - satRank[b.saturation_status];
  });

  return enriched.slice(0, limit);
}

export const __test = { postalMatchesZone, pickSaturation };

// ── F27-C — Capacity classification for a single route ─────────────────────────
export type RouteCapacityStatus = "available" | "tight" | "saturated" | "unknown";

export function resolveRouteCapacityStatus(
  route: Pick<RouteRow, "cap_deliveries" | "current_deliveries" | "cap_volume_m3" | "current_volume_m3"> | null | undefined
): { status: RouteCapacityStatus; ratio: number | null; reason: string } {
  if (!route) return { status: "unknown", ratio: null, reason: "Sem rota seleccionada" };
  const cap = route.cap_deliveries;
  if (cap == null || cap <= 0) {
    const vCap = route.cap_volume_m3;
    if (vCap == null || vCap <= 0) return { status: "unknown", ratio: null, reason: "Capacidade não definida" };
    const vUsed = Number(route.current_volume_m3 ?? 0);
    const r = vUsed / Number(vCap);
    if (r >= 1) return { status: "saturated", ratio: r, reason: "Volume da rota esgotado" };
    if (r >= 0.85) return { status: "tight", ratio: r, reason: "Volume da rota quase esgotado" };
    return { status: "available", ratio: r, reason: "Volume disponível" };
  }
  const used = Number(route.current_deliveries ?? 0);
  const r = used / Number(cap);
  if (r >= 1) return { status: "saturated", ratio: r, reason: "Entregas da rota esgotadas" };
  if (r >= 0.85) return { status: "tight", ratio: r, reason: "Rota quase cheia" };
  return { status: "available", ratio: r, reason: "Rota com folga" };
}
