# F29 — Fase 7 (Bloco 10) — Pipeline de Vendas + Realtime

## Auditoria

- **Notificações realtime globais** já estavam implementadas em `NotificationsBell` (subscrição `postgres_changes` em `notifications` + RPCs `notification_list_for_user`/`notification_mark_read`/`notification_mark_all_read`).
- **Realtime operacional** coberto por `useOperationalRealtime` (F26-B): `usePaymentsRealtime`, `useRouteRealtime`, `useManufacturingRealtime`, `useIndicatorsRealtime`, `usePickingRealtime`.
- **Estados de vendas** já presentes em `sale_orders.state` (draft/sent/confirmed/done/cancelled) + colunas derivadas `fulfillment_status`, `payment_status`, `invoice_status`, `operational_status` na view `sale_orders_with_schedule_summary`.
- **Filtros por estado** já disponíveis em `SalesOrdersList` e `QuotationsList`.

## Bloco 10 — Acrescentado nesta fase

**Vista Kanban "Pipeline de Vendas"** (`/sales/pipeline`):

- 4 colunas (Rascunho · Enviado · Confirmado · Concluído) com contador e total monetário por coluna.
- Cada card: número, cliente, valor, badges de fulfillment/pagamento e data de entrega/pedido.
- Click no card → abre o pedido (`/sales/orders/:id`).
- **Realtime**: `useOperationalRealtime` em `sale_orders` (debounce 600ms) → mudanças de estado refletem-se sem refresh.
- **Polling fallback**: 30s.
- Sidebar: novo item "Pipeline" no topo da secção "Comercial".

## Próximas fases

- **Fase 8 (Bloco 11):** Já feito na Fase 1 (migração BNPL).
- F29 considerada **concluída** após esta fase.
