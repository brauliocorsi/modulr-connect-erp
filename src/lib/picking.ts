// Portuguese labels for stock picking states & kinds
export const STATE_PT: Record<string, string> = {
  draft: "Rascunho",
  waiting: "A aguardar",
  ready: "Pronto",
  done: "Realizado",
  cancelled: "Cancelado",
  confirmed: "Confirmado",
  partial: "Parcial",
  posted: "Lançado",
  paid: "Pago",
  pending: "Pendente",
};

export const KIND_PT: Record<string, string> = {
  incoming: "Entrada",
  outgoing: "Saída",
  internal: "Interna",
};

export const stateLabel = (s?: string | null) => (s ? STATE_PT[s] ?? s : "—");
export const kindLabel = (k?: string | null) => (k ? KIND_PT[k] ?? k : "—");
