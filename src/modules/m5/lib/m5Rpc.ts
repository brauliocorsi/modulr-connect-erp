import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Tradução de códigos de erro M5 para mensagens claras em PT.
// Apenas mapeia strings devolvidas pelo backend — não inventa regras.
const M5_ERRORS: Record<string, string> = {
  forbidden: "Sem permissão para esta ação.",
  sale_order_not_found: "Venda não encontrada.",
  invalid_state: "Estado inválido para esta ação.",
  pickup_not_found: "Levantamento não encontrado.",
  pickup_not_pending: "O levantamento já não está pendente.",
  pickup_not_ready: "O levantamento ainda não está pronto para validar.",
  no_lines: "Sem linhas de venda para levantar.",
  no_stock: "Sem stock disponível para levantar.",
  damaged_blocks_pickup: "Existem packages danificados/em quarentena — bloqueado.",
  damaged_blocks_carrier: "Existem packages danificados/em quarentena — não podem ser entregues à transportadora.",
  schedule_not_found: "Schedule não encontrado.",
  schedule_not_active: "Schedule já não está ativo.",
  carrier_not_found: "Transportadora não encontrada.",
  carrier_missing_location: "A transportadora não tem stock_location_id configurado.",
  carrier_state_invalid: "Schedule não está no estado correto para handover.",
  not_with_carrier: "Schedule não está com transportadora.",
  invalid_condition: "Condição de retorno inválida.",
  route_not_found: "Rota não encontrada.",
  cash_closure_exists: "Caixa da rota já foi fechada.",
  closure_pending: "Falta fechar a caixa da rota antes de fechar.",
  payment_method_missing: "Método de pagamento não configurado.",
  invalid_amount: "Valor inválido.",
  session_not_found: "Sessão de caixa não encontrada.",
  session_not_open: "Sessão de caixa não está aberta.",
  cash_requires_session: "Pagamentos em dinheiro requerem sessão de caixa aberta.",
  vehicle_not_empty: "Ainda há packages na viatura — retorne ao armazém antes de reagendar.",
  reschedule_blocked_damaged: "Existem packages danificados/em quarentena que bloqueiam o reagendamento.",
  duplicate_active_schedule: "Já existe um schedule ativo para esta venda.",
};

export function translateM5Error(err: any): string {
  if (!err) return "Erro desconhecido";
  const code = typeof err === "string" ? err : err?.error ?? "";
  if (M5_ERRORS[code]) {
    const extras: string[] = [];
    if (err?.packages != null) extras.push(`${err.packages} package(s)`);
    if (err?.count != null) extras.push(`${err.count}`);
    return extras.length ? `${M5_ERRORS[code]} (${extras.join(", ")})` : M5_ERRORS[code];
  }
  return code || err?.message || "Erro desconhecido";
}

export async function callM5Rpc(
  fn: string,
  args: Record<string, any>,
  label: string,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) {
    const msg = error.message ?? String(error);
    toast.error(`${label}: ${msg}`);
    return { ok: false, error: msg };
  }
  if (data && data.ok === false) {
    const msg = translateM5Error(data);
    toast.error(`${label}: ${msg}`);
    return { ok: false, error: msg, data };
  }
  toast.success(`${label} OK`);
  return { ok: true, data };
}
