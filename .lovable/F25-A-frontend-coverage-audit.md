# F25-A — Frontend Coverage Audit (Backend × Frontend)

Data: 2026-05-20

## 1. Matriz cobertura

| Domínio | Backend existe? | Frontend existe? | Rota | Menu | Operável? | Prioridade | Ação F25-A |
|---|---|---|---|---|---|---|---|
| Centros de trabalho (`work_centers`) | ✅ tabela | ❌ | ❌ | ❌ | ❌ | P0 | **Criar `WorkCentersPage` read-only** |
| Operações (`manufacturing_operations`) | ✅ tabela | ❌ | ❌ | ❌ | ❌ | P0 | **Criar `OperationsPage` read-only** |
| Máquinas | ❌ tabela `machines` **NÃO existe** | ❌ | ❌ | ❌ | ❌ | P0 backend gap | **Não criar página.** Documentar gap. Backlog F25-B |
| Ordens de fabrico (`manufacturing_orders`) | ✅ | ✅ `ManufacturingOrdersList` | ✅ `/manufacturing/orders` | ✅ | ✅ | — | — |
| Planeamento (`manufacturing_planning`) | ✅ | ✅ `ManufacturingPlanning` | ✅ | ✅ | ✅ | — | — |
| Chão de fábrica | ✅ | ✅ `ShopFloorBoard` | ✅ `/shop-floor` | ✅ | ✅ | — | — |
| Pacotes danificados (`stock_packages condition='damaged'`) | ✅ tabela + RPCs (`service_case_create_from_damaged_package`) | ❌ | ❌ | ❌ | ❌ | **P0** | **Criar `DamagedStockPage`** |
| Quarentena (`stock_packages condition='quarantine'`) | ✅ tabela | ❌ | ❌ | ❌ | ❌ | **P0** | **Criar `QuarantinePage`** |
| Reparações (`service_case_items` + RPCs F18-C) | ✅ | ❌ | ❌ | ❌ | ❌ | **P0** | **Criar `ServiceRepairsPage`** |
| Casos de Assistência (`service_cases`) | ✅ | ✅ `ServiceRequestsList` | ✅ `/service/requests` | ✅ | ✅ | — | — |
| Helpdesk Tickets | ✅ | ✅ `CustomerTicketsList` | ✅ `/helpdesk/tickets` | ✅ | ✅ | — | — |
| Portal Cliente público (`/portal/:token`) | ✅ | ✅ `CustomerPortalPage` | ✅ pública | n/a | ✅ | — | — |
| Tokens Portal (`customer_portal_tokens`) | ✅ tabela + `customer_portal_token_create` | ❌ admin UI | ❌ | ❌ | ❌ | P1 | **Criar `PortalTokensPage`** (read-only + revogar) |
| RMA | parcial (em `service_cases`) | parcial | n/a | n/a | parcial | P2 | backlog F25-B |
| Localizações Quarentena/Repair (`stock_locations`) | ✅ | parcial via `LocationsList` | ✅ | ✅ | ✅ | — | — |

## 2. RPCs usadas neste bloco

- `service_case_create_from_damaged_package(_stock_package_id, _description, _action)`
- `service_case_dispose_package(_case_item_id, _reason)`
- `service_case_release_repaired_to_stock(_case_item_id, _target_location_id)`
- `service_case_repair_start(_case_item_id, _notes)`
- `service_case_repair_complete(_case_item_id, _result, _notes)`
- `customer_portal_token_create(_customer_id, _sale_order_id, _service_case_id, _scope, _expires_at)`

Sem write direto. Sem `insert/update/delete` em `stock_packages`, `service_cases`, `service_case_items`, `customer_portal_tokens`.

## 3. Páginas entregues F25-A

1. `/manufacturing/work-centers` — `WorkCentersPage` (read-only)
2. `/manufacturing/operations` — `OperationsPage` (read-only)
3. `/inventory/damaged` — `DamagedStockPage` (read + abrir caso de reparação)
4. `/inventory/quarantine` — `QuarantinePage` (read + abrir caso/descartar)
5. `/service/repairs` — `ServiceRepairsPage` (read + start/complete/dispose/release)
6. `/helpdesk/portal-tokens` — `PortalTokensPage` (read; geração avançada → F25-B)

Atualizado: `App.tsx`, `MODULES` registry.

## 4. Backlog F25-B

- Tabela `machines` + CRUD + manutenção/OEE.
- CRUD completo de `work_centers` e `manufacturing_operations` (faltam RPCs `_upsert/_archive`).
- Filtros avançados, agrupamentos e analytics em Danificados/Quarentena.
- Portal Cliente: geração de tokens, revogação granular, multi-scope, audit.
- RMA dedicado.
- Manutenção preventiva, capacidade finita, planejamento visual.
- Scanner barcode + upload de fotos para danos.

## 5. Zero-bypass

Grep esperado (0 hits):

```
rg -n "from\((work_centers|manufacturing_operations|stock_packages|package_damage_reports|service_cases|service_case_items|customer_portal_tokens)['\"]\)\.(insert|update|upsert|delete)" src/modules src/core
```
