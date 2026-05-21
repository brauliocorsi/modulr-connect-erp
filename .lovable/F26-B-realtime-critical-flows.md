# F26-B — Realtime nos Fluxos Operacionais Críticos

Pré-requisito: F26-A (infra em `src/core/realtime`).

## 1. Matriz realtime por página

| Página                       | Tabelas escutadas                                                                                                                          | Evento  | Queries / handler invalidado                                                                                            | Debounce | Risco                                                          |
|------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------|---------|--------------------------------------------------------------------------------------------------------------------------|----------|----------------------------------------------------------------|
| PaymentsPage                 | `customer_payments`, `cash_movements`, `cash_sessions`, `bank_reconciliation_lines`, `supplier_payments`                                   | `*`     | `load()` (useState-based)                                                                                                | 400 ms   | refetch storm mitigado por debounce                            |
| PickingScan                  | `stock_pickings`, `stock_packages`, `stock_moves` (filtrado por `picking_id` quando aplicável)                                              | `*`     | `loadPending()` apenas quando **não** há picking ativo                                                                  | 500 ms   | race com optimistic scan — evitado: handler desligado em picking aberto |
| RouteDetail                  | `delivery_routes`, `delivery_schedules`, `vehicle_route_manifest`, `stock_packages`, `customer_payments`, `cash_movements`, `delivery_route_orders`, `dock_transfers` | `*` | `route-detail`, `route-orders`, `route-manifest`, `route-docks`, `route-capacity`, `route-pickings` (todos por `routeId`) | 400 ms   | escopado por `routeId`; baixo                                  |
| ManufacturingOrderDetail     | `manufacturing_orders`, `mo_components`, `mo_operations`, `mo_issues`, `mo_quality_checks`, `work_orders`, `stock_moves`, `purchase_needs`  | `*`     | `manufacturing_order`, `mo-comps`, `mo-ops`, `mo-iss`, `mo-qc`, `work-orders`, `purchase_needs`                          | 400 ms   | baixo; canal único por MO                                      |
| IndicatorsPage               | `activity_events` (INSERT), `notifications` (INSERT), `sale_orders`, `manufacturing_orders`, `purchase_needs`, `delivery_routes`, `customer_tickets`, `service_cases` | `*` / `INSERT` | invalidação por prefixo `["indicator"]`                                                                          | 2500 ms  | 28 cards → debounce alto evita re-render storm                 |

## 2. Entregas

1. **`src/core/realtime/operationalHooks.ts`** — hooks de domínio:
   - `usePaymentsRealtime({ enabled, onChange })`
   - `usePickingRealtime({ pickingId, enabled, onChange })`
   - `useRouteRealtime({ routeId, enabled })`
   - `useManufacturingRealtime({ moId, enabled })`
   - `useIndicatorsRealtime({ enabled })`
   - utilitário interno `useOperationalRealtime({...})`
   - todos aceitam `enabled`, fazem cleanup, usam debounce, nunca lançam para a UI (try/catch já existente em `useRealtimeChannel`).
2. **`src/core/realtime/index.ts`** — barrel atualizado.
3. **PaymentsPage.tsx** — chama `usePaymentsRealtime` com `loadRef` (re-load alvo).
4. **PickingScan.tsx** — chama `usePickingRealtime` apenas quando não há picking ativo. Em picking ativo o estado é otimista via `scan_increment_move`, e o realtime fica desligado para não sobrescrever scans em curso.
5. **RouteDetail.tsx** — chama `useRouteRealtime({ routeId: id })`.
6. **ManufacturingOrderDetail.tsx** — chama `useManufacturingRealtime({ moId: id })`.
7. **IndicatorsPage.tsx** — chama `useIndicatorsRealtime()` (debounce 2.5s, invalida prefixo `["indicator"]`).
8. **`src/core/realtime/__tests__/operationalHooks.test.tsx`** — 5 testes:
   - PaymentsPage: subscribe das 5 tabelas + debounce → onChange chamado 1x.
   - RouteDetail: desligado sem `routeId`, ligado com `routeId`.
   - ManufacturingOrder: invalidação efetiva das query keys esperadas.
   - Indicators: invalida `["indicator"]` 1x mesmo com 3 eventos em rajada.
   - PickingScan: filtro `picking_id=eq.<id>` aplicado em `stock_moves`.

## 3. Testes

`bunx vitest run` → **268/268 passing** (263 anteriores + 5 novos).

## 4. Zero-bypass

Nenhum `.update()` / `.insert()` / `.delete()` novo. Tudo é `supabase.channel(...).on('postgres_changes', ...)` (read-only).

## 5. Decisões deliberadas

- **PickingScan**: handler desligado durante picking ativo. A operação do scanner é otimista; sobrescrever via realtime causaria flicker e perda de scans em curso. Quando a transferência é validada/fechada, o handler volta a ouvir para refletir a próxima pendente.
- **IndicatorsPage**: debounce de 2.5s. Em vez de invalidar 28 query keys distintas, invalida o prefixo `["indicator"]` — todas as cards se atualizam num único ciclo do React Query.
- **PaymentsPage**: usa `useState` (não React Query). Mantemos o padrão e disparamos o `load()` original via `loadRef`.
- **RouteDetail/MO**: queries já tinham keys estáveis; basta invalidar com `useOperationalRealtime`.

## 6. Não fizemos (fora do escopo F26-B)

- Presence / typing.
- Push (web ou mobile).
- Workflows / IA / MCP.
- Backend triggers novos.
- Reescrita das telas.

## 7. Backlog futuro

- Fallback automático (polling leve) se um canal falhar persistentemente.
- Métricas de saúde dos canais (count subscribers, last event).
- Estender `useIndicatorsRealtime` para mostrar badge "novos eventos" e adiar invalidação até clique, em ambientes com tráfego muito alto.
