## Visão geral

Quatro blocos integrados:

1. **Scanner de colis na entrega** (entregador scaneia caixa-a-caixa, não item a item).
2. **Pagamento multi-método na entrega** (ex.: 70€ dinheiro + 30€ MB).
3. **Novo módulo "Assistência"** — entregador abre pedido após entrega; equipa interna trata depois.
4. **Caixa do entregador com rastreabilidade por rota + ciclo de prestação de contas / conciliação financeira**.

---

## 1. Scanner de colis (em vez de item-a-item)

Hoje `DeliveryPicking.tsx` scaneia produtos individuais. Vamos passar a scanear **packages** (colis) que já saíram do armazém.

**Migração:**
- Confirmar `stock_moves.package_id` (já existe nas funções de putaway). Caso falte, adicionar `stock_quants.package_id` e `stock_moves.package_id`.
- Tabela `stock_packages` (se ainda não existir): `id, name (barcode), picking_id, state ('packed'|'delivered')`.

**UI (`DeliveryPicking.tsx`):**
- Lista de **colis** da entrega em vez de moves.
- Cada colis com badge "Por entregar / Entregue" + lista resumida dos produtos dentro.
- Scan do código → marca o colis como entregue.
- Só desbloqueia "Entregar e Cobrar" quando todos os colis estão scaneados.
- Mantém fallback para scanear produto avulso se a encomenda não tiver colis.

---

## 2. Pagamento multi-método

**Migração — nova RPC:**
```
driver_deliver_picking_multi(_picking uuid, _payments jsonb)
-- _payments: [{method_id, amount}]
-- Cria N customer_payments + N cash_movements (com route_id, picking_id)
-- Valida picking; soma tem de igualar saldo em aberto (tol. 0.01)
```
- Adicionar colunas `cash_movements.route_id uuid`, `cash_movements.picking_id uuid`.
- RPC antiga `driver_deliver_picking` passa a delegar.

**UI (diálogo "Cobrança na entrega"):**
- Linhas dinâmicas `[método ▾] [valor] [×]`, botão "+ Adicionar pagamento".
- Mostra: total cobrado / saldo aberto / falta. Botão "Distribuir restante".
- Confirma só quando soma == saldo.

---

## 3. Novo módulo "Assistência"

**Migração:**
```
service_requests
  id, name (SR-####), partner_id, product_id, picking_id (origem),
  route_id, reported_by (driver), state ('new'|'triaged'|'scheduled'|'in_progress'|'done'|'cancelled'),
  description text, photos jsonb, priority text, assigned_to uuid,
  created_at, updated_at
service_request_messages  (chatter já existente via record_messages)
```
RLS: motorista cria/lê os seus; `service_manager` / `system_admin` gerem todos.

**UI motorista:**
- Após entrega concluída, em `DeliveryPicking.tsx`, botão "Abrir assistência" → diálogo: produto da entrega (select), descrição, prioridade, fotos (storage bucket).

**UI equipa (novo módulo `src/modules/service/`):**
- Página lista (`ServiceRequestsList.tsx`) com filtros por estado/atribuído/zona.
- Página detalhe (`ServiceRequestForm.tsx`) com chatter, atribuir responsável, agendar, fechar.
- Entrada na sidebar: "Assistência".

---

## 4. Caixa do entregador + ciclo de prestação de contas

**Migração:**
- `cash_sessions.route_id uuid` (sessão pode estar associada a uma rota).
- Estado adicional: `cash_sessions.handover_state text DEFAULT 'none'` com valores `none | pending_handover | reconciled`.
- `cash_sessions.handover_at`, `handover_by`, `reconciled_at`, `reconciled_by`, `reconciliation_notes`.
- RPC:
  - `driver_handover_session(_session uuid)` — fecha caixa físico do entregador, marca `pending_handover`, calcula totais por método.
  - `finance_reconcile_session(_session uuid, _notes text)` — gestor financeiro confirma; marca `reconciled`. Liga cada `customer_payment` da rota a essa conciliação (já existe `reconciled_at` em `cash_movements`).

**UI motorista (`DeliveryCashbox.tsx`):**
- Topo: rota ativa (zona, data, veículo).
- Cards por método **da rota corrente** (Dinheiro destacado, MB, Cartão, Transferência, …).
- Lista por entrega: cliente + valores recebidos (uma linha por método).
- Botão grande **"Encerrar e entregar caixa"** → `driver_handover_session`. Caixa fica **"Pendente de conferência financeira"** e o entregador não pode iniciar nova rota.
- Se houver sessão `pending_handover`, esconde botão de abrir nova sessão e mostra aviso.

**UI financeiro (novo `src/modules/finance/pages/DriverHandoversPage.tsx`):**
- Lista de sessões `pending_handover` agrupadas por entregador/rota.
- Detalhe: resumo por método, lista de pagamentos da rota, vendas associadas com pendências cruzadas (mostra se a venda ainda tem saldo, faltas, etc.).
- Botão **"Conferir e conciliar"** → `finance_reconcile_session`. Marca `reconciled` e fecha o ciclo.
- Entrada no menu Financeiro: "Entregas e caixa".

---

## 5. Ficheiros afetados

**Migrações SQL** (uma por bloco preferencialmente):
- Colis (se necessário).
- `cash_movements` colunas + RPC `driver_deliver_picking_multi`.
- `service_requests` + `service_request_photos` (bucket).
- `cash_sessions` colunas + RPCs handover/reconcile.

**Frontend:**
- `src/modules/delivery/pages/DeliveryPicking.tsx` — scanner de colis + diálogo multi-pagamento + botão assistência.
- `src/modules/delivery/pages/DeliveryCashbox.tsx` — resumo por rota + handover.
- `src/modules/delivery/pages/DeliveryHome.tsx` — bloqueia nova rota se sessão pendente.
- `src/modules/service/` (novo) — `ServiceRequestsList.tsx`, `ServiceRequestForm.tsx`, `OpenServiceRequestDialog.tsx`.
- `src/modules/finance/pages/DriverHandoversPage.tsx` (novo) + entrada de menu.
- `src/core/modules/registry.ts` — registar módulo `service`.

---

## Notas

- A construção é grande; sugiro implementar pela ordem 2 → 4 → 1 → 3 (impacto vs. esforço).
- Fluxo de assistência reutiliza chatter (`record_messages`) e storage já configurado.
- Bloqueio de nova rota só avisa, não impede em modo admin (override `system_admin`).
