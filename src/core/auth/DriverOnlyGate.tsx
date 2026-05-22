import { Navigate, useLocation } from "react-router-dom";
import { usePermissions } from "@/core/permissions/usePermissions";

/**
 * Bloqueia o ERP completo para utilizadores que só tenham o grupo `delivery_driver`.
 * Drivers só podem usar `/delivery/*`. O chat fica embutido em `/delivery/discuss`.
 */
export function DriverOnlyGate({ children }: { children: React.ReactNode }) {
  const { groups, loading } = usePermissions();
  const loc = useLocation();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Carregando…</div>;
  const driverOnly = groups.length > 0 && groups.every((g) => g === "delivery_driver");
  if (driverOnly) {
    const path = loc.pathname;
    if (path.startsWith("/discuss")) {
      const rest = path.slice("/discuss".length);
      return <Navigate to={`/delivery/discuss${rest}`} replace />;
    }
    if (!path.startsWith("/delivery")) {
      return <Navigate to="/delivery" replace />;
    }
  }
  return <>{children}</>;
}
