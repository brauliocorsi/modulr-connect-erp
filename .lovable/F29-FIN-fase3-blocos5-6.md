# F29 — Fase 3 (Blocos 5+6) — Picking D-1 e Levantamentos

## Bloco 5 — Separação em Armazém (D-1) ✅ NOVO

**Rota:** `/warehouse/picking` (criada)

Página `WarehousePickingPage.tsx`:
- Selector de data (default = amanhã), polling 60s.
- Lista de `delivery_routes` (`state in ('planned','in_progress')`).
- Por cada rota: barra de progresso `separadas/total` + `carregadas/total`.
- Expansão da rota mostra cada paragem (`delivery_route_orders` ordenadas por `sequence`):
  - Para cada venda, faz lookup em `stock_pickings` por `origin = sale_order.name` e `kind='outgoing'`.
  - Mostra `stock_moves` com produto, localização origem (bin/loc), checkbox para marcar separado (atualiza `quantity_done` no move).
  - Botão "Validar separação" chama RPC `validate_picking` quando todos os moves estão completos.
- Botão "Confirmar Carga no Veículo" chama RPC `delivery_load_vehicle(_route_id)` quando todas as paragens estão prontas (estado físico em `picked/ready/loaded/in_truck`).

## Bloco 6 — Levantamentos ✅ JÁ EXISTIA (alias)

A página `m5/pages/PickupsPage.tsx` já cobre o fluxo (`create_customer_pickup`, `delivery_pick_to_pickup_area`, `validate_customer_pickup` com `_picked_up_by_name`/`_picked_up_by_doc` e pagamento opcional).

Acrescentado alias `/warehouse/pickups` em `App.tsx` para alinhar com o prompt master. Item da sidebar passa a apontar para `/warehouse/pickups` (a rota `/m5/pickups` permanece como compatibilidade).

## Sidebar

Grupo "Logística" → adicionado "Separação D-1 (Armazém)" e renomeado link de Levantamentos para `/warehouse/pickups`.

## Próximas fases sugeridas

- Fase 4 (Bloco 7): Dashboard de compras + receção parcial com defeitos.
- Fase 5 (Bloco 8): Despesas recorrentes + calendário (já existe `RecurringExpensesPage`, falta calendário).
- Fase 6 (Bloco 9): Conciliação bancária com sugestão automática.
- Fase 7 (Bloco 10): Pipeline de estados em vendas + notificações realtime globais.
