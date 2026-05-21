# F27-C — Agendamento Seguro a partir do Cronograma

## Auditoria
- `delivery_schedules`: tabela existente, com unique parcial para evitar 2 ativos por SO (status ≠ cancelled/delivered/rescheduled), status check incluindo `requested|scheduled|confirmed|...|cancelled`.
- RPCs existentes: `delivery_schedule_create`, `delivery_schedule_reschedule`, `delivery_schedule_assign`, `delivery_schedule_cancel`.
  - Limitação: `delivery_schedule_create` exige `operational_status ∈ (ready_delivery, reserved, completed)` — bloqueia agendamento antecipado a partir do calendário.
- Trigger `tg_delivery_schedules_protect_logistics` bloqueava qualquer mudança de `route_id/status/...` para utilizadores fora de `inventory_*` / `system_admin`.
- View `sale_orders_with_schedule_summary` já consumida pelo OrderForm/print.
- Rota: opcional. Janela slot_start/slot_end: opcional. Capacidade via `delivery_routes.cap_deliveries` + `current_deliveries`.

## Decisões
- Criado wrapper único `sale_order_schedule_delivery(_sale_order_id, _scheduled_date, _slot_start, _slot_end, _route_id, _notes)`:
  - Permissões: `sales_manager|sales_user|inventory_*|system_admin`.
  - Bloqueia: `pickup_cannot_schedule_delivery`, `delivery_not_included`, `sale_order_cancelled|done`, `invalid_slot_window`, `route_date_mismatch`, `route_not_open`.
  - Idempotente: se já houver schedule ativo para a SO, atualiza-o; caso contrário INSERT.
  - Capacidade: `available | tight (≥0.85) | saturated (≥1)` — warnings no payload, sem bloquear.
  - Log via `_m3_log` (timeline da SO).
- Trigger `tg_delivery_schedules_protect_logistics` estendido para autorizar `sales_manager|sales_user`.

## Frontend
- `src/modules/sales/components/ScheduleSaleOrderDeliveryDialog.tsx`: dialog único usado em calendário e SaleDeliveryPanel.
  - Detecta schedule ativo (modo "Reagendar") via `delivery_schedules`.
  - Mostra sugestões por CP (reaproveita `suggestDeliveryDays`).
  - Rotas do dia escolhido via `delivery_routes` (planned/in_progress/draft).
  - Chip de capacidade (`resolveRouteCapacityStatus`).
  - Saturado exige confirmação explícita.
- `DeliveryScheduleCalendar`: novo banner "Em foco" + botão Agendar/Reagendar; botão Reagendar em cada schedule do drawer; botão "Agendar venda em foco" no drawer.
- `SaleDeliveryPanel`: botão "Agendar entrega" / "Reagendar" no header (estado com transferência) e no estado vazio.

## Capacity warning
- Helper puro `resolveRouteCapacityStatus(route)` em `src/modules/sales/lib/deliverySchedule.ts`.
- Estados: `available | tight | saturated | unknown`.
- Fallback para volume quando `cap_deliveries` ausente.

## Tests
- `src/modules/sales/lib/__tests__/resolveRouteCapacityStatus.test.ts` (7 tests).
- Suite total: **289/289 ✅** (vitest run).

## Zero bypass
```
rg "from\(['\"](delivery_schedules|delivery_routes|sale_orders)['\"]\)\.(insert|update|upsert|delete)" src/modules src/core
→ 0 hits
```

## Backlog F27-D
- Drag & drop entre dias/rotas no calendário.
- Criação assistida de rota a partir do calendário.
- Notificação ao cliente (SMS/WhatsApp/email).
- Otimização logística automática (TSP/multi-stop).
- App motorista, assinatura, IA/MCP.
