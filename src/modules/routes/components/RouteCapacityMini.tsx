import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type VehicleLite = {
  name?: string | null;
  usable_volume_m3?: number | null;
  volume_m3?: number | null;
  max_stops?: number | null;
  assembly_minutes_capacity?: number | null;
  max_assembly_minutes?: number | null;
} | null;

type RouteCapInput = {
  cap_deliveries?: number | null;
  current_deliveries?: number | null;
  cap_volume_m3?: number | null;
  current_volume_m3?: number | null;
  cap_assembly_minutes?: number | null;
  current_assembly_minutes?: number | null;
  max_deliveries?: number | null;
  max_assembly_minutes?: number | null;
  vehicles?: VehicleLite;
};

function toneFor(pct: number | null) {
  if (pct === null) return "bg-muted";
  if (pct >= 95) return "bg-rose-500";
  if (pct >= 75) return "bg-amber-500";
  return "bg-emerald-500";
}

function num(v: any, digits = 1) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function RouteCapacityMini({ route, compact = false }: { route: RouteCapInput; compact?: boolean }) {
  const capDel =
    route.cap_deliveries ??
    route.max_deliveries ??
    route.vehicles?.max_stops ??
    null;
  const capVol =
    route.cap_volume_m3 ??
    route.vehicles?.usable_volume_m3 ??
    route.vehicles?.volume_m3 ??
    null;
  const capAsm =
    route.cap_assembly_minutes ??
    route.max_assembly_minutes ??
    route.vehicles?.assembly_minutes_capacity ??
    route.vehicles?.max_assembly_minutes ??
    null;

  const useDel = Number(route.current_deliveries ?? 0);
  const useVol = Number(route.current_volume_m3 ?? 0);
  const useAsm = Number(route.current_assembly_minutes ?? 0);

  const rows = [
    { key: "del", label: "Paragens", used: useDel, cap: capDel, unit: "", digits: 0 },
    { key: "vol", label: "m³", used: useVol, cap: capVol, unit: " m³", digits: 1 },
    { key: "asm", label: "Mont.", used: useAsm, cap: capAsm, unit: " min", digits: 0 },
  ];

  const bars = rows.map((r) => {
    const pct = r.cap && r.cap > 0 ? Math.min(100, Math.round((r.used / r.cap) * 100)) : null;
    return { ...r, pct };
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={compact ? "space-y-0.5 mt-0.5" : "space-y-1 mt-1"}>
          {bars.map((b) => (
            <div key={b.key} className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground w-8 shrink-0">{b.label}</span>
              <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                {b.pct !== null && (
                  <div className={`h-full ${toneFor(b.pct)}`} style={{ width: `${b.pct}%` }} />
                )}
              </div>
              <span className="text-[9px] tabular-nums text-muted-foreground w-7 text-right">
                {b.pct === null ? "—" : `${b.pct}%`}
              </span>
            </div>
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="space-y-0.5">
          <div><b>Paragens:</b> {useDel} / {capDel ?? "—"}</div>
          <div><b>Volume:</b> {num(useVol)} / {num(capVol)} m³</div>
          <div><b>Montagem:</b> {useAsm} / {capAsm ?? "—"} min</div>
          {route.vehicles?.name && (
            <div className="text-muted-foreground">Viatura: {route.vehicles.name}</div>
          )}
          {!route.vehicles && (route.cap_volume_m3 == null) && (
            <div className="text-amber-500">Sem viatura — capacidade não definida</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
