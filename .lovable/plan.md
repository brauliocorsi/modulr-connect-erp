# Fluxo de Status da Venda (Fase 1)

## Novos estados de `fulfillment_status`

Substituir/expandir o conjunto atual (`pending, backordered, purchased, partial, ready, delivered, cancelled`) por:

| Status | Quando aplica |
|---|---|
| `pending` | Venda confirmada, sem PO ainda e sem stock |
| `ordered` (**Encomendado**) | Existe PO em rascunho ligada à venda |
| `purchased` (**Encomenda efetuada**) | PO confirmada — produto a caminho |
| `partial_available` (**Disponível parcial**) | Parte do stock reservado, parte ainda em receção |
| `available` (**Disponível p/ agendar**) | Tudo reservado e pronto, sem agendamento |
| `scheduled` (**Agendado**) | Picking outgoing tem `scheduled_at` futuro definido pelo utilizador OU está num batch com data |
| `delivered_partial` (**Entregue parcial**) | Picking outgoing concluído com backorder gerada |
| `delivered` (**Entregue**) | Todos os pickings outgoing `done`, mas sem prestação de contas no caixa |
| `settled` (**Entregue & prestado**) | Entregue + cash_movements/payment do motorista reconciliados na sessão de caixa |
| `cancelled` | Venda cancelada |

## Regras

### 1. Confirmação de PO → "Encomenda efetuada"
- Em `confirm_purchase_order`: para cada SO ligada via `purchase_order_origins` ou `origin`, chamar `recalc_so_fulfillment`.
- `recalc_so_fulfillment` passa a distinguir:
  - PO draft → `ordered`
  - PO confirmada (não recebida) → `purchased`

### 2. Recebimento da PO → "Disponível"/"Disponível parcial"
- Já feito por `reserve_incoming_to_origin_so`. Ajustar `recalc_so_fulfillment`:
  - Tudo reservado → `available`
  - Parte reservada + parte ainda incoming → `partial_available`

### 3. Agendamento da entrega → "Agendado"
- Quando o utilizador define `scheduled_at` no picking outgoing OU adiciona o picking a um `stock_picking_batch` com `delivery_date`, marcar `scheduled` (se ainda `available`).
- Trigger em `stock_pickings` (update de `scheduled_at` ou `batch_id`) chama `recalc_so_fulfillment`.

### 4. Entrega → "Entregue" / "Entregue parcial"
- `validate_picking` já gera backorder. Em `recalc_so_fulfillment`:
  - Pickings done com backorder ativa → `delivered_partial`
  - Todos pickings done sem backorder → `delivered`

### 5. Prestação de contas → "Entregue & prestado" (`settled`)
- Após `driver_deliver_picking` E quando a `cash_session` do motorista é fechada (ou o `cash_movement` ligado ao payment está reconciliado), promover para `settled`.
- Trigger em `cash_sessions` (update state→closed) e em `cash_movements` (insert) recalcula SOs envolvidas.

### 6. Cancelamento com realocação automática
- Novo `cancel_sale_order` (e cancelamento de picking outgoing):
  1. Liberta reservas (`release_move_reservation`).
  2. Procura outras SOs `confirmed` em estado `pending`/`backordered`/`purchased`/`partial_available` que precisem do mesmo produto, ordenadas por `created_at`.
  3. Para cada move pendente dessas SOs, chama `reserve_for_move`.
  4. Se reserva > 0, envia `notify_user` ao salesperson da SO beneficiada: *"Reserva libertada da venda X foi atribuída à sua venda Y"*.
  5. Recalcula fulfillment das SOs afetadas.

## Detalhes técnicos

### Backend (migration única)
1. **Função `recalc_so_fulfillment`** — reescrever lógica:
   ```
   se cancelled → cancelled
   se draft/sent → pending
   se todos outgoing done:
       se backorder ativa → delivered_partial
       else se cash settled → settled
       else → delivered
   se algum outgoing tem batch_id ou scheduled_at futuro definido manualmente → scheduled
   se qty_reserved >= qty_total → available
   se qty_reserved>0 e qty_incoming>0 → partial_available
   se qty_incoming>0 e PO confirmada → purchased
   se qty_incoming>0 e PO draft → ordered
   senão → pending
   ```
2. **Helper `so_is_settled(_so)`** — true quando todos os `customer_payments` ligados aos pickings estão em `cash_movements` cuja `cash_session` está `closed`.
3. **Trigger novo `tg_picking_schedule_change`** em `stock_pickings` (UPDATE de `scheduled_at`, `batch_id`) → `recalc_so_fulfillment`.
4. **Trigger novo em `cash_sessions`** (state → closed) → recalcula todas as SOs com pickings done cujo motorista pertence a esta sessão.
5. **Função nova `reallocate_freed_stock(_product, _warehouse)`** — chamada por `cancel_sale_order` e por `cancel_picking` outgoing; faz a realocação + notificação descrita em §6.
6. **Atualizar `confirm_purchase_order`** para fazer `recalc_so_fulfillment` em todas as SOs ligadas (não só na criação).

### Frontend
- `src/core/orders/FulfillmentBadge.tsx`: adicionar entradas para `ordered`, `purchased`, `partial_available`, `available`, `scheduled`, `delivered_partial`, `settled` com cores distintas (slate→amber→blue→sky→emerald→green→teal). Manter `partial`, `ready`, `delivered`, `backordered` como aliases retrocompatíveis durante transição.
- `src/modules/sales/pages/SalesPages.tsx`: atualizar opções do filtro `fulfillment_status` da `SalesOrdersList`.
- `src/modules/inventory/pages/ShipmentsPage.tsx` e `TransfersList.tsx`: usar nova badge.
- Detalhe da venda: card "Estado de fulfillment" com timeline horizontal dos estados (Encomendado → Encomenda efetuada → Disponível → Agendado → Entregue → Prestado), highlight do estado atual e razão (ex.: "PO00001 confirmada, ETA 2026-05-20").

## Fora desta fase (a tratar depois)
- Reagendamentos, falha de entrega, entrega parcial paga parcialmente, expiração de reservas — conforme indicado pelo utilizador.

## Ficheiros a alterar
- Migration nova: `recalc_so_fulfillment`, triggers de scheduling/cash, `reallocate_freed_stock`, atualização de `cancel_sale_order` / `cancel_picking` / `confirm_purchase_order`.
- `src/core/orders/FulfillmentBadge.tsx`
- `src/modules/sales/pages/SalesPages.tsx` (opções de filtro)
- `src/core/orders/OrderForm.tsx` ou painel da venda: timeline visual do fulfillment.
