## Objetivo

Unificar o fluxo de agendamento entre **Vendas** e **Inventário/Logística**, com confirmação bilateral e **timeline auditável** (quem, quando, de→para, motivo) em cada agendamento, reagendamento e cancelamento.

Hoje existem **dois sistemas paralelos** que não conversam:

| Sistema | Tabela / RPC | Onde é usado |
|---|---|---|
| A (Vendas) | `delivery_schedules` + `sale_order_schedule_delivery` / `delivery_schedule_reschedule` / `_cancel` | Calendário de Vendas, painel da SO |
| B (Inventário) | `stock_pickings.route_id` + `schedule_picking_to_route` / `reschedule_picking` | WH/OUT, dialog do picking, RouteAssignmentCard |

Por isso uma agenda feita em Vendas não preenche `route_id` no picking, e vice-versa, e os botões "Reagendar/Agendar" ficam confusos.

## O que vamos construir

### 1. Sincronização Vendas ↔ Inventário

- Quando **Vendas** chama `sale_order_schedule_delivery` (cria/atualiza `delivery_schedules`), passa também a propagar `route_id` e `scheduled_at` para o `stock_picking` outgoing dessa SO (se existir).
- Quando **Inventário** usa `schedule_picking_to_route` ou `reschedule_picking`, passa a **criar/atualizar** o `delivery_schedules` ativo da SO (mesma `unique` constraint já existente) chamando internamente `delivery_schedule_create/reschedule`.
- Cancelar agendamento (botão "Cancelar agendamento" do `DeliveryStatusBadge`) passa a invocar `delivery_schedule_cancel` em vez de só limpar `route_id`/`scheduled_at` na tabela do picking.

Resultado: existe **uma única verdade** (`delivery_schedules`) e o `stock_picking` é mantido em espelho.

### 2. Fluxo de confirmação bilateral

Usar os status já presentes em `delivery_schedules.status` para modelar o handshake:

```text
Vendedora propõe     →  status = 'requested'    (vendedora vê, cliente combinou)
Inventário confirma  →  status = 'confirmed'    (mantém data) ou
Inventário reagenda  →  status = 'rescheduled'  + cria novo registo 'confirmed' noutra data
Carga inicia         →  status = 'loading' / 'loaded' (já existe via fluxo de rota)
```

- No **painel da Venda (SO)**: chip mostra "Aguarda confirmação da logística" / "Confirmada pela logística para dd/mm" / "Reagendada pela logística para dd/mm — ver motivo".
- Na **transferência WH/OUT** e na **Rota**: aparece a proposta da vendedora destacada com botões **Confirmar data** / **Propor outra data** (abre dialog com motivo obrigatório).
- A vendedora recebe notificação via `notify_user` quando a logística confirma ou contrapropõe (já existe infra-estrutura — `reschedule_picking` já notifica salesperson).

### 3. Timeline (activity_events) de agendamento

Criar eventos em `activity_events` em **ambas as entidades** (`sale_order` e `stock_picking`) sempre que algo mudar, com `metadata` rica para a UI já existente do `RecordTimeline` exibir:

| event_type | Mensagem | metadata |
|---|---|---|
| `delivery_schedule_requested` | "Entrega proposta por {ator} para {data} ({rota/zona})" | `{from:null, to:date, route_id, slot, by_role}` |
| `delivery_schedule_confirmed` | "Logística confirmou entrega em {data}" | `{schedule_id, route_id, by_role}` |
| `delivery_schedule_rescheduled` | "Reagendado de {old} para {new}. Motivo: {x}" | `{old_date, new_date, old_route, new_route, reason, by_role}` |
| `delivery_schedule_cancelled` | "Agendamento cancelado. Motivo: {x}" | `{schedule_id, reason}` |
| `delivery_route_assigned` | "Atribuído à rota {zona} de {data}" | `{route_id, route_date, vehicle}` |

Os eventos são gravados pelas RPCs (lado servidor, com `auth.uid()` → `actor_user_id`) para garantir auditoria mesmo se a UI mudar. Já existe `RecordTimeline` que lê via `activity_list_for_entity` — só precisamos popular `activity_events` e adicionar os novos `EVENT_LABEL` no componente.

### 4. UI — clareza dos botões

- `DeliveryStatusBadge` ganha 3 estados visuais distintos:
  - **Cinza** "Entrega não agendada" → botão primário **Agendar entrega**
  - **Âmbar** "Aguarda confirmação da logística" (status `requested`) → botão **Confirmar / Propor outra data** (só para roles `inventory_*`)
  - **Verde** "Entrega confirmada · {data} · {rota}" → botão **Reagendar** (que agora também é a única ação para mudar data)
- O botão **Reagendar** fica desativado com tooltip quando não há `route_id`, e o **Agendar** desaparece quando já há agenda — fim da confusão atual.
- Mesma badge é usada em `TransferForm`, `SaleDeliveryPanel`, `RouteDetail` → comportamento uniforme.

### 5. Onde a timeline aparece

- `TransferForm` (WH/OUT) — já tem secção timeline; passa a mostrar os novos eventos.
- `OrderForm` (SO) — já tem `RecordTimeline`; passa a mostrar os mesmos eventos espelhados na entidade `sale_order`.
- `RouteDetail` — adicionar painel `RecordTimeline` agregando eventos das `stock_pickings` da rota (filtrados pelo `entity_id` da rota + dos pickings linkados).

## Detalhes técnicos (para revisão)

**Migração 1 — RPCs alteradas (sem mudança de assinatura):**
- `schedule_picking_to_route(_picking, _route)`: além do `UPDATE stock_pickings`, chama `delivery_schedule_create/assign` para a SO de origem (se existir) e grava `activity_events` em `stock_picking` + `sale_order`.
- `reschedule_picking(_picking, _new_date, _reason)`: chama `delivery_schedule_reschedule` para o schedule ativo da SO; grava eventos com `old_date/new_date/reason/route_id`.
- `sale_order_schedule_delivery(...)`: após inserir/atualizar `delivery_schedules`, faz `UPDATE stock_pickings SET route_id, scheduled_at WHERE origin = so.name AND kind='outgoing' AND state NOT IN ('done','cancelled')`. Grava eventos.
- `delivery_schedule_reschedule` / `_cancel` / `_assign`: passam a gravar `activity_events` (hoje só logam internamente).

**Migração 2 — Função auxiliar:**
```sql
CREATE FUNCTION log_schedule_event(_so uuid, _picking uuid, _type text, _msg text, _meta jsonb)
```
que insere em `activity_events` para `sale_order` e (se houver) para `stock_picking`, com `actor_user_id = auth.uid()`.

**Frontend:**
- `DeliveryStatusBadge.tsx` — refatorar para os 3 estados + permissões (`usePermissions`).
- `ScheduleDeliveryDialog.tsx` — incluir campo "motivo" obrigatório quando há reagendamento; quando vem do inventário e há `delivery_schedule` em `requested`, mostra a proposta original e botões Confirmar/Propor.
- `RecordTimeline.tsx` — acrescentar entradas no `EVENT_LABEL` (`delivery_schedule_*`, `delivery_route_assigned`) e renderização amigável do `metadata` (de→para, rota, motivo).
- `RouteDetail` — incluir um `<RecordTimeline entityType="delivery_route" entityId={route.id} />` (eventos da rota + escutar pickings via metadata).

## O que NÃO entra agora
- Refactor profundo do `delivery_schedules` (estados, transições).
- Notificações por e-mail.
- Histórico em UI dedicada — basta a timeline existente.
