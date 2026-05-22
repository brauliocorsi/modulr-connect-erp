import { Navigate, useLocation } from "react-router-dom";
import { usePermissions } from "@/core/permissions/usePermissions";

/**
 * Bloqueia o ERP completo para utilizadores que só tenham o grupo `delivery_driver`.
 * Permite apenas `/delivery/*` e `/discuss/*` (este último para conversar com a equipa).
 */
export function DriverOnlyGate({ children }: { children: React.ReactNode }) {
  const { groups, loading } = usePermissions();
  const loc = useLocation();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Carregando…</div>;
  const driverOnly = groups.length > 0 && groups.every((g) => g === "delivery_driver");
  if (driverOnly) {
    const path = loc.pathname;
    if (!path.startsWith("/delivery") && !path.startsWith("/discuss")) {
      return <Navigate to="/delivery" replace />;
    }
  }
  return <>{children}</>;
}
