import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

export interface DockTransferRow {
  id: string;
  status: string;
  dock_name?: string | null;
  lane_code?: string | null;
  picking_name?: string | null;
  moved_at?: string | null;
  loaded_at?: string | null;
}

interface Props {
  transfers: DockTransferRow[];
  orphanCount: number;
  occupiedLaneAlerts: string[];
}

const STATUS_VARIANT: Record<string, string> = {
  planned: "outline",
  moved_to_dock: "default",
  loaded: "secondary",
  cancelled: "destructive",
};

export function RouteDockSection({ transfers, orphanCount, occupiedLaneAlerts }: Props) {
  return (
    <Card>
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <div className="font-semibold text-sm">Cais / Lane</div>
        <div className="text-xs text-muted-foreground">{transfers.length} transferência(s)</div>
      </div>

      {(orphanCount > 0 || occupiedLaneAlerts.length > 0) && (
        <div className="px-3 py-2 border-b bg-amber-50 text-amber-900 text-xs space-y-1">
          {orphanCount > 0 && (
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" /> {orphanCount} dock_transfer(s) sem rota válida.
            </div>
          )}
          {occupiedLaneAlerts.map((m, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" /> {m}
            </div>
          ))}
        </div>
      )}

      <table className="w-full text-xs">
        <thead className="bg-muted/30">
          <tr>
            <th className="text-left px-2 py-1.5">Transferência</th>
            <th className="text-left px-2 py-1.5">Cais</th>
            <th className="text-left px-2 py-1.5">Lane</th>
            <th className="text-left px-2 py-1.5">Estado</th>
            <th className="text-left px-2 py-1.5">Movido</th>
            <th className="text-left px-2 py-1.5">Carregado</th>
          </tr>
        </thead>
        <tbody>
          {transfers.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                Sem dock_transfers para esta rota.
              </td>
            </tr>
          ) : (
            transfers.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="px-2 py-1.5 font-mono">{t.picking_name ?? t.id.slice(0, 8)}</td>
                <td className="px-2 py-1.5">{t.dock_name ?? "—"}</td>
                <td className="px-2 py-1.5">{t.lane_code ?? "—"}</td>
                <td className="px-2 py-1.5">
                  <Badge variant={(STATUS_VARIANT[t.status] as any) ?? "outline"} className="text-[10px]">
                    {t.status}
                  </Badge>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {t.moved_at ? new Date(t.moved_at).toLocaleString() : "—"}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {t.loaded_at ? new Date(t.loaded_at).toLocaleString() : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
