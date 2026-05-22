## Objetivo

Na lista de **Inventário › Transferências** (`/inventory/transfers`):
1. Mostrar a **data de entrega confirmada** (a que a logística confirmou em `delivery_schedules`) como nova coluna.
2. Permitir filtrar a lista por **intervalo de data confirmada** e manter o filtro de estado **Pronto** (já é o default da página).

## Onde mexer

Apenas em `src/modules/inventory/pages/TransfersList.tsx` (frontend, sem mudanças no backend).

## Como vai funcionar

### Fonte do dado "data confirmada"
- `delivery_schedules.status = 'confirmed'` com `scheduled_at` representa a data confirmada pela logística.
- A tabela está ligada à venda (`sale_order_id`), e o `stock_picking` traz `origin` = nome da SO. A forma mais direta sem mudar a query principal:
  1. Após buscar as linhas (`rows`), recolher os `origin` distintos do tipo SOxxxxx.
  2. Fazer um único `select` em `delivery_schedules` com `status='confirmed'` join `sale_orders!inner(name)` filtrando por esses nomes.
  3. Construir um mapa `{ saleOrderName → confirmedAt }` e usar para preencher a coluna e o filtro client-side.
- Em pickings internos/de entrada (sem SO) a célula mostra "—".

### Nova coluna
- Adicionar em `COL_DEFS`: `{ key: "confirmed_at", label: "Data confirmada" }`.
- Adicionar `<SortHead>` no cabeçalho (ordenação client-side já que o campo é derivado).
- Adicionar `<td>` formatado com `fmtDateTime` (de `@/lib/format`); quando não houver, mostrar "—" cinza.
- Visível por default; respeita o popover de "Colunas".

### Novo filtro
- Adicionar em `<AdvancedFilters>` dois campos `type: "date"`:
  - `confirmed_from` — "Confirmada de"
  - `confirmed_to` — "Confirmada até"
- Aplicação **client-side** (após o map de confirmações): manter apenas linhas com `confirmedAt` dentro do intervalo. Se ambos vazios, não filtra.
- O preset `defaults={{ state: "ready" }}` já existe — apenas confirmar que continua a aplicar-se.

### Pequenos ajustes
- Recalcular `visibleRows` e `grouped` para considerar o filtro de data confirmada.
- Incluir o mapa de confirmações nas dependências do `useMemo`.
- Ordenação por `confirmed_at`: tratar nulls como "no fim" independentemente da direção.

## Fora do scope
- Não alterar RPCs, triggers ou `delivery_schedules`.
- Não mexer no modo agrupado para além de aplicar o mesmo filtro de data confirmada na lista expandida.
- Sem alterações no detalhe da transferência.
