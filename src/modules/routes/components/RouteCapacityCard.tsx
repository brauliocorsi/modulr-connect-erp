import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface ManifestStats {
  totalPackages: number;
  loadedCount: number;
  deliveredCount: number;
  returnedCount: number;
  maxLength: number;
  maxWidth: number;
  maxHeight: number;
  fragileCount: number;
  notStackableCount: number;
  flatTransportCount: number;
}

interface Props {
  capacity: any | null;
  stats: ManifestStats;
}

function pct(used: number | null | undefined, cap: number | null | undefined): number {
  if (!cap || cap <= 0) return 0;
  return Math.min(100, Math.round((Number(used ?? 0) / Number(cap)) * 100));
}

function num(v: any, digits = 2): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function RouteCapacityCard({ capacity, stats }: Props) {
  const c = capacity ?? {};
  const rows: Array<{ label: string; used: any; cap: any; unit: string }> = [
    { label: "Entregas", used: c.current_deliveries, cap: c.cap_deliveries, unit: "" },
    { label: "Volume", used: c.current_volume_m3, cap: c.cap_volume_m3, unit: " m³" },
    { label: "Peso", used: c.current_weight_kg, cap: c.cap_weight_kg, unit: " kg" },
    { label: "Montagem", used: c.current_assembly_minutes, cap: c.cap_assembly_minutes, unit: " min" },
  ];

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">Capacidade & Dimensões</div>
        <div className="text-xs text-muted-foreground">
          Status: <span className="font-medium">{c.status ?? "—"}</span>
        </div>
      </div>

      <div className="grid gap-2">
        {rows.map((r) => {
          const p = pct(r.used, r.cap);
          return (
            <div key={r.label} className="text-xs">
              <div className="flex justify-between mb-0.5">
                <span>{r.label}</span>
                <span className="font-medium tabular-nums">
                  {num(r.used)} / {num(r.cap)}
                  {r.unit} · {p}%
                </span>
              </div>
              <Progress value={p} className="h-1.5" />
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t">
        <div>
          <div className="text-muted-foreground">Maior C</div>
          <div className="font-medium tabular-nums">{num(stats.maxLength, 1)} cm</div>
        </div>
        <div>
          <div className="text-muted-foreground">Maior L</div>
          <div className="font-medium tabular-nums">{num(stats.maxWidth, 1)} cm</div>
        </div>
        <div>
          <div className="text-muted-foreground">Maior A</div>
          <div className="font-medium tabular-nums">{num(stats.maxHeight, 1)} cm</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t">
        <div>
          <div className="text-muted-foreground">Frágeis</div>
          <div className="font-medium tabular-nums">{stats.fragileCount}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Não empilháveis</div>
          <div className="font-medium tabular-nums">{stats.notStackableCount}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Transp. plano</div>
          <div className="font-medium tabular-nums">{stats.flatTransportCount}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t">
        <div>
          <div className="text-muted-foreground">Carregados</div>
          <div className="font-medium tabular-nums">{stats.loadedCount}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Entregues</div>
          <div className="font-medium tabular-nums">{stats.deliveredCount}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Retornados</div>
          <div className="font-medium tabular-nums">{stats.returnedCount}</div>
        </div>
      </div>
    </Card>
  );
}
