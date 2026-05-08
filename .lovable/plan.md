## Objetivo

Implementar 4 melhorias no inventário:

1. **Quantidades inteiras por tipo de UoM** — produtos cuja unidade de medida é "unidade/peça" só aceitam inteiros (input com `step=1`, validação no formulário e no `OrderForm`); UoMs contínuas (kg, m, l) mantêm decimais.

2. **Backorders automáticas** — ao validar uma picking (entrada/saída/interna), se algum movimento tiver `quantity_done < quantity`, criar automaticamente uma nova `stock_pickings` em estado `ready` com a diferença pendente, ligada por `backorder_id` à original. Aplica-se a `incoming`, `outgoing` e `internal`.

3. **Criar transferência interna manual** — botão "Nova transferência interna" em `InternalTransfersPage` que abre um formulário (origem, destino, parceiro opcional, linhas de produtos+quantidades) e cria a picking em estado `draft`/`ready`.

4. **Estados em português** — mapa `pt` para `state` e `kind` aplicado em todas as páginas/badges (`ShipmentsPage`, `ReceiptsPage`, `TransferForm`, `InternalTransfersPage`, `MovesPage`).

## Detalhes técnicos

### Backend (migration)
- Adicionar coluna `backorder_id uuid references stock_pickings(id)` em `stock_pickings`.
- Modificar `validate_picking(_picking)`:
  - Após processar quants e marcar moves done, detectar moves onde `quantity_done < quantity`.
  - Se existirem, criar nova `stock_pickings` (mesmo `kind`, `source/dest`, `partner`, `origin`, `warehouse`, `backorder_id = _picking`, nome via `next_sequence` adequada) com novos `stock_moves` para a quantidade restante (`quantity = quantity - quantity_done`), estado `ready`, e tentar `reserve_for_move` para outgoing.
- Aplicar a `incoming`, `outgoing`, `internal`.
- Adicionar sequência `picking_internal` se não existir.

### Frontend
- `src/lib/uom.ts` (novo) — helper `isIntegerUom(uomCategory|name)` reconhecendo "unit", "unidade", "pç", "pcs".
- `src/lib/picking.ts` (novo) — mapas `STATE_PT`, `KIND_PT`.
- `ProductForm` / `OrderForm` / `TransferForm` — usar `step={isInt ? 1 : 0.01}` e `Math.floor` em onChange para UoMs inteiras.
- `InternalTransfersPage` — botão "Nova" → dialog ou nova rota `/inventory/transfers/new?kind=internal` reutilizando um form simples.
- Substituir labels de estado pelos PT em todas as tabelas/badges relevantes.

### Ficheiros tocados
- migration nova
- `src/lib/uom.ts` (novo), `src/lib/picking.ts` (novo)
- `src/modules/inventory/pages/TransferForm.tsx`
- `src/modules/inventory/pages/InternalTransfersPage.tsx`
- `src/modules/inventory/pages/ShipmentsPage.tsx`, `ReceiptsPage.tsx`, `MovesPage.tsx`
- `src/modules/products/pages/ProductForm.tsx` (qty inicial)
- `src/core/orders/OrderForm.tsx` (input qty linhas)
