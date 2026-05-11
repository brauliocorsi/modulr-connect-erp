## Objetivo

Transformar a atribuição de rota num **fluxo por botão** (em vez de cartão sempre visível), disponível tanto na **transferência (inventário)** como na **venda (sales)**, e mostrar de forma clara o **estado da entrega** (`Não agendada` / `Agendada`) com a rota associada nos dois lados.

## Mudanças propostas

### 1. RouteAssignmentCard → modal/dialog reutilizável
Refatorar `src/modules/inventory/components/RouteAssignmentCard.tsx` em dois componentes:
- `ScheduleDeliveryDialog` — modal com a UI atual (date picker, sugestões por CP, lista de rotas abertas, capacidade/avisos, confirmar/remover/trocar).
- `DeliveryStatusBadge` — badge compacto que mostra:
  - **Não agendada** (cinzento) quando `picking.route_id` é nulo
  - **Agendada** (verde) com nome da rota + data + cor da zona quando há rota
  - Botão "Agendar" / "Trocar rota" que abre o dialog
  - Botão "Remover" quando já agendada

O dialog continua a usar `suggest_route` e `schedule_picking_to_route` e a permitir trocar a data (reagendar).

### 2. TransferForm (inventário)
Em `src/modules/inventory/pages/TransferForm.tsx` (linha 561-563):
- Substituir o `<RouteAssignmentCard …>` sempre visível por uma linha compacta:
  - `DeliveryStatusBadge` + botão `Agendar entrega` / `Trocar rota`
- Manter `onChanged={load}` para refrescar.

### 3. OrderForm (vendas)
Em `src/core/orders/OrderForm.tsx` (bloco `kind === "sale" && shipment`, linha 503-515):
- Substituir o cartão verde estático por um cartão com:
  - `DeliveryStatusBadge` (mesmo componente)
  - Botão **Agendar entrega** quando `shipment.route_id` é nulo → abre o `ScheduleDeliveryDialog` passando o picking
  - Botão **Trocar rota** quando já agendada
  - Link "Abrir transferência" mantido
- Atualizar o `select` da query `sale-shipment` para incluir `route_id` e ao agendar, juntar o nome/data da rota (via join `delivery_routes(route_date, delivery_zones(name,color))`).

### 4. Estado de entrega derivado
Sem alterações de schema — o estado é calculado a partir de `stock_pickings.route_id`:
- `route_id IS NULL` → **Não agendada**
- `route_id IS NOT NULL` e `state != 'done'` → **Agendada** (mostrar rota + data)
- `state = 'done'` → **Entregue** (mantém comportamento atual)

### 5. Listas (opcional, mesmo PR)
Adicionar coluna/badge "Entrega" em:
- `TransfersList.tsx` (já lista pickings) — mostra `DeliveryStatusBadge` em modo read-only.
- Lista de vendas (em `SalesPages.tsx`) — idem, derivado do shipment associado.

## Detalhes técnicos

- O dialog usa `Dialog` de `@/components/ui/dialog` com `DialogContent` largo (`max-w-2xl`).
- `DeliveryStatusBadge` aceita `picking: { route_id, scheduled_at }` + `route?: { route_date, delivery_zones }` opcional para evitar nova query quando o pai já tem a info.
- Reagendamento: o dialog já permite escolher outra data e outra rota → chama `schedule_picking_to_route` (substitui `route_id` e `scheduled_at`).
- Realtime: `OrderForm` já tem subscription a `stock_pickings`, então o badge atualiza sozinho ao agendar pelo inventário, e vice-versa.
- Sem alterações de migração/RLS.

```text
[Venda SO00010]                          [Transferência OUT/00007]
 ┌───────────────────────────┐            ┌───────────────────────────┐
 │ Entrega: ● Não agendada   │            │ Entrega: ● Não agendada   │
 │ [ Agendar entrega ]       │            │ [ Agendar entrega ]       │
 └─────────────┬─────────────┘            └─────────────┬─────────────┘
               │  abre Dialog                           │
               ▼                                        ▼
   ┌────────────────────────────────┐      (mesmo Dialog reutilizado)
   │ Data: [11/05/2026]             │
   │ Rotas sugeridas (por CP)       │
   │ ─ Norte 11/05 · 3/10 · 90 min  │
   │ ─ Norte 13/05 · 1/10 · 200 min │
   │ [Confirmar]                    │
   └────────────────────────────────┘
               │ confirma
               ▼
 ┌───────────────────────────┐            ┌───────────────────────────┐
 │ Entrega: ● Agendada       │            │ Entrega: ● Agendada       │
 │ Rota Norte · 11/05        │            │ Rota Norte · 11/05        │
 │ [ Trocar rota ] [Remover] │            │ [ Trocar rota ] [Remover] │
 └───────────────────────────┘            └───────────────────────────┘
```

## Ficheiros tocados

- `src/modules/inventory/components/RouteAssignmentCard.tsx` → renomear/repartir em `ScheduleDeliveryDialog.tsx` + `DeliveryStatusBadge.tsx`
- `src/modules/inventory/pages/TransferForm.tsx` → usar badge + dialog
- `src/core/orders/OrderForm.tsx` → substituir cartão estático
- (opcional) `src/modules/inventory/pages/TransfersList.tsx`, `src/modules/sales/pages/SalesPages.tsx` → badge na listagem