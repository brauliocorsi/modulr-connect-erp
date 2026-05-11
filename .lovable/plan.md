
# Agendamento de entregas por Rotas (app dedicada "Rotas")

## Como funciona hoje (resumo)
- Vendas confirmadas geram cadeia de transferências (Pick → Carga → Entrega).
- A última etapa é colocada num **Lote** (`stock_picking_batches`) com data + motorista + carrinha; o app de entregas mostra esse lote.
- Já existem `delivery_zip_rules`, `partners.zip`, `sale_orders.commitment_date / include_assembly / include_delivery`. O produto tem `assembly_fee` mas **não tem tempo de montagem**.

## O que muda
Introduzimos **Zonas** (faixas de CP com motorista/carrinha/capacidade padrão) e **Rotas** (instância diária de uma zona). As entregas confirmadas com cliente passam a ser sugeridas para a rota da zona/dia. Os vendedores e o app de entregas usam o **novo módulo Rotas** como hub central.

Lotes existentes ficam preservados em modo leitura (legado).

---

## 1. Modelo de dados

**`delivery_zones`**
- `name`, `zip_from`, `zip_to`, `color`, `active`
- `default_driver_id`, `default_vehicle_id`
- `max_deliveries_per_day` (int), `max_assembly_minutes_per_day` (int)
- `weekdays` (array 0–6)

**`delivery_routes`** — 1 por zona/dia
- `zone_id`, `route_date`, `driver_id`, `vehicle_id`
- `max_deliveries`, `max_assembly_minutes` (copiados, editáveis)
- `state` (`planned` | `in_progress` | `done` | `cancelled`)
- `notes`
- Único `(zone_id, route_date)`

**`stock_pickings`**: + `route_id` (FK nullable). `batch_id` mantém-se (legado).

**`products`**: + `assembly_minutes` (numeric, default 0) — minutos por unidade.

## 2. Lógica (Postgres)

- `suggest_route(_so uuid, _from_date date)` — devolve as próximas 15 datas/rotas candidatas para a zona do CP do cliente, com `remaining_deliveries`, `remaining_minutes`, flag `would_exceed`.
- Minutos da venda = `Σ assembly_minutes × quantity` (apenas linhas de produto, e só se `include_assembly = true`).
- Aplica-se apenas a vendas com `include_delivery = true`.
- `schedule_picking_to_route(_picking, _route)` — define `route_id`, `scheduled_at`, `commitment_date`. Se exceder limite → não bloqueia, mas devolve `warning` + 3 próximas rotas com folga (opção "Sugerir próxima data").
- `validate_route(_route)` — valida todas as entregas da rota (reusa `validate_picking`).
- `generate_routes(_horizon_days int default 15)` — para cada zona ativa cria as `delivery_routes` em falta nos próximos 15 dias (respeitando `weekdays`).

## 3. Novo módulo "Rotas" (item de topo no menu principal)

Ícone Truck, entre "Inventário" e "Entregas". Aceita `inventory_user`, `sales_user`, `delivery_driver` em leitura; gestão para `inventory_manager`/`system_admin`.

```
/routes
├── /routes                    Cronograma (default)
├── /routes/list               Lista de rotas
├── /routes/:id                Detalhe da rota
├── /routes/zones              Zonas (CRUD)
└── /routes/zones/:id          Editor de zona
```

**Cronograma (`/routes`)** — vista calendário/Kanban
- Eixo X = próximos 15 dias; eixo Y = zonas. Cada cartão mostra a rota com barras de capacidade (X/Y entregas, Z/W min) coloridas por zona.
- Clique → abre detalhe.
- Botão "Gerar próximos 15 dias" + filtro por motorista/zona.
- Pesquisa por cliente / nº venda → realça rotas onde aparece.

**Detalhe da rota (`/routes/:id`)**
- Cabeçalho: zona, data, motorista, carrinha, estado, capacidade.
- Lista de entregas (drag-to-reorder), mini-mapa opcional (fora deste plano).
- Vendedores podem **adicionar venda** a esta rota (selector com filtro por CP).
- Botões "Iniciar", "Validar todas", "Cancelar".

**Zonas (`/routes/zones`)** — CRUD: nome, CP de/até, dias da semana, motorista/carrinha padrão, capacidades.

## 4. Inventário — vínculo na lista de transferências

A lista existente de Transferências ganha:
- Nova **coluna "Rota"** mostrando `zona · data` (clicável → `/routes/:id`).
- Filtro lateral "Rota" (select).
- Na ficha da transferência (`TransferForm`) bloco "Rota atribuída" com botões **Atribuir / Reagendar** (abre `RouteScheduler`).

## 5. Vendas

**Formulário da Venda** (secção entrega, quando `include_delivery` on e CP preenchido)
- Mostra a zona detetada e date picker "Data desejada".
- Ao escolher → chama `suggest_route` e mostra cartão da rota (motorista, carrinha, capacidade restante).
- Aviso amarelo se exceder + 3 próximas datas livres com botão "Usar esta".
- Confirmar → `schedule_picking_to_route`.

**Vendedores no app Rotas**: leitura completa do cronograma para apoiar a marcação ao telefone com o cliente.

## 6. Cadastro de Produto
Campo "Minutos de montagem por unidade" no separador principal (perto de `assembly_fee`).

## 7. App de Entregas (`/delivery`)
- "Os meus lotes" passa a "**As minhas rotas**": lê `delivery_routes` onde `driver_id = auth.uid()` e `route_date >= hoje`.
- Detalhe da rota reusa a UI atual (pickings, scan, cobrança).
- Sub-secção "Lotes antigos" enquanto existirem lotes legados pendentes.

## 8. Geração automática (15 dias)
- Botão manual em `/routes` (chama `generate_routes`).
- Edge function `routes-generator` invocada por cron diário (pg_cron + pg_net) às 01:00.

## 9. Migração de dados
- Cada `stock_picking_batches` em `draft`/`in_progress` com `delivery_date` futura → cria `delivery_route` correspondente (zona inferida pelo CP do primeiro cliente; `NULL` se não bater) e move `route_id` dos pickings.
- Lotes `done`/`cancelled` ficam intactos no separador legado.

## 10. RLS
- `delivery_zones`, `delivery_routes`: leitura para `inventory_user`, `sales_user`, `delivery_driver` (este só vê onde é `driver_id`); escrita para `inventory_manager`/`system_admin`.
- `stock_pickings.route_id`: regras existentes.

## 11. Entregáveis técnicos
- Migração SQL (tabelas + colunas + índices + RLS + funções).
- Edge function `routes-generator` + cron.
- Novo módulo `src/modules/routes/`: `RoutesShell`, `RoutesSchedule` (calendário), `RoutesList`, `RouteForm`, `ZonesList`, `ZoneForm`, componente partilhado `RouteScheduler` (modal usado por Vendas e Inventário).
- Atualizar: `AppShell` (item "Rotas" no menu), `core/modules/registry.ts`, `OrderForm` (bloco agendamento), `ProductForm` (minutos), `TransfersList` + `TransferForm` (coluna/bloco rota), `DeliveryHome`/`DeliveryBatch` (passar a rotas).

## Fora deste plano
- Otimização do trajeto em mapa.
- Notificação automática ao cliente (SMS/email) da data agendada.
