import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Mapeia códigos de erro das RPCs M3/M4 para mensagens claras em PT.
// IMPORTANTE: não inventa regras — só traduz strings retornadas pelo backend.
const CLOSE_ERRORS: Record<string, (extra: any) => string> = {
  vehicle_not_empty: (e) => `Ainda há ${e?.packages ?? "?"} package(s) na viatura. Descarregue/retorne antes de fechar.`,
  orders_open: (e) => `Há ${e?.open ?? "?"} pedido(s) ainda em aberto (não entregues, falhados nem retornados).`,
  manifests_unverified: (e) => `Há ${e?.count ?? "?"} item(ns) do manifesto sem verificação de carga.`,
  route_not_found: () => "Rota não encontrada.",
  forbidden: () => "Sem permissão de logística para fechar a rota.",
};

const GENERIC_ERRORS: Record<string, string> = {
  forbidden: "Sem permissão para esta ação.",
  route_not_found: "Rota não encontrada.",
  route_order_not_found: "Pedido da rota não encontrado.",
  invalid_state: "A rota não está no estado correto para esta ação.",
  no_pickings: "Não há transferências para mover para o cais.",
  no_lines_to_load: "Não há linhas para carregar.",
  package_not_in_manifest: "Package não consta do manifesto desta rota.",
  package_not_in_vehicle: "O package não está fisicamente na viatura.",
  already_delivered: "Package já entregue.",
  return_location_missing: "Localização de retorno não configurada.",
  invalid_mode: "Modo de retorno inválido.",
  dock_required: "Selecione um cais antes de mover.",
  vehicle_required: "A rota não tem viatura associada.",
};

export function translateError(action: "close" | "generic", err: any, extra?: any): string {
  const code = typeof err === "string" ? err : err?.error ?? "";
  if (action === "close" && CLOSE_ERRORS[code]) return CLOSE_ERRORS[code](extra ?? err);
  if (GENERIC_ERRORS[code]) return GENERIC_ERRORS[code];
  return code || "Erro desconhecido";
}

export async function callRouteRpc(
  fn: string,
  args: Record<string, any>,
  label: string,
  opts: { closeContext?: boolean } = {}
): Promise<{ ok: boolean; data?: any; error?: string }> {
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) {
    const msg = error.message ?? String(error);
    toast.error(`${label}: ${msg}`);
    return { ok: false, error: msg };
  }
  if (data && data.ok === false) {
    const msg = translateError(opts.closeContext ? "close" : "generic", data, data);
    toast.error(`${label}: ${msg}`);
    return { ok: false, error: msg, data };
  }
  toast.success(`${label} OK`);
  return { ok: true, data };
}
