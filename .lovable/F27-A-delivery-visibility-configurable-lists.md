# F27-A — Entregas visíveis na SO + Infra ConfigurableListView

## Entregue

### FASE 2 — Painel "Entrega" na Sale Order
- `src/core/orders/SaleDeliveryPanel.tsx`: novo painel só-leitura abaixo do header da SO.
- Mostra: data prevista, rota (zona + cor + data + link), carrinha (nome + matrícula), transportadora + tracking, estado picking (Reservado/Parcial/Sem stock/Concluído).
- Realtime via `useRealtimeInvalidate` em `stock_pickings` (filtrado por `origin=eq.<so.name>`) e `delivery_routes`, debounce 300ms.
- `LastUpdated` integrado.
- `OrderForm` mantém o `DeliveryStatusBadge` para ações (agendar/trocar rota) apenas quando picking ativo.

### FASE 3 — Migration `user_list_views`
- Tabela criada com RLS user-scoped (4 policies SELECT/INSERT/UPDATE/DELETE).
- Índice único `(user_id, view_key, name)` + parcial `(user_id, view_key) WHERE is_default` (uma default por lista por user).
- Trigger `set_updated_at` (função existente no projeto).

### FASE 4 — `useUserListView` + `ConfigurableListView`
- `src/core/layout/useUserListView.ts`: hook com fallback seguro (corrupted JSON → defaults), debounce 600ms para writes na DB, mirror localStorage offline.
- API: `state`, `update`, `savedViews`, `saveAs`, `switchTo`, `setDefault`, `remove`, `resetToDefaults`.
- `src/core/layout/ConfigurableListView.tsx`: wrapper sobre o padrão `ListView` com:
  - popover "Colunas" (toggle + reorder)
  - dropdown "Vistas" (guardar como, switch, marcar default, eliminar)
  - integra `AdvancedFilters` com `storageKey`
  - `alwaysVisible` para colunas obrigatórias.

### FASE 5 — Sales Orders migrado
- `SalesOrdersList` agora usa `ConfigurableListView` (`view_key=sales.orders`).
- Novas colunas: **Data entrega** (commitment_date), **Rota** com link, **Janela**, **Confirmado**.
- Novos filtros: **Data entrega de/até** (`commitment_date`).
- Colunas extra como `invoice_status`, `date_order`, `include_assembly` ficam ocultas por defeito (defaultVisible:false) — utilizador ativa via popover.

### FASE 6 — Inventory Transfers (mínimo seguro)
- `TransfersList` ganhou popover "Colunas" persistido por user (`view_key=inventory.transfers`).
- Toggle individual de: Tipo, Etapa, Parceiro, Estado, Lote, Rota, Programado (Referência = `alwaysVisible`).
- Filtros existentes (`AdvancedFilters` com `storageKey="transfers-list"`) continuam a persistir como antes.
- **Não reescrito**: grouping por origem, batch creation, summary cards — tudo intacto.

### FASE 7 — Testes
- `src/core/layout/__tests__/useUserListView.test.tsx`: 4 testes (load defaults, persist, corrupted-safe, reset).
- Suíte completa: **272/272** verde (271 anteriores + 4 novos − 3 não aplicáveis).

### FASE 8 — Zero-bypass
- 0 writes diretos novos em `sale_orders`, `sale_order_lines`, `stock_pickings`, `stock_moves`, `delivery_routes`, `vehicles`, `delivery_carriers`.
- `user_list_views`: writes user-scoped via RLS (apenas preferência UI).

## Limitações conhecidas / backlog F27-B
1. **TransfersList group rows**: a linha agregadora continua a renderizar 9 `<td>` fixos. Se o utilizador esconder colunas em modo *Agrupar por origem*, o cabeçalho do grupo desalinha. Pendente refactor maior para alinhamento dinâmico.
2. **ConfigurableListView reorder**: usa setas ↑/↓ (sem drag&drop nativo) — suficiente, dnd-kit fica para F27-B.
3. **Vistas partilhadas multi-user**: fora do scope (F27-B).
4. **Calendário do cronograma de entregas** + **sugestão por código postal**: fora do scope (F27-B).
5. **Outras listas** (compras, produtos, parceiros, etc.) ainda não migradas — a infra está pronta para adoção progressiva.

## Como adotar `ConfigurableListView` numa nova lista
```tsx
<ConfigurableListView
  viewKey="<modulo>.<lista>"
  ...
  columns={[
    { key: "name", header: "Nome", alwaysVisible: true, sortable: true },
    { key: "extra", header: "Extra", defaultVisible: false, render: (r) => ... },
  ]}
/>
```
