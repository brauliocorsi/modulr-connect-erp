
# Vendas + Inventário — Fulfillment, Cronograma e Rastreio

## 1. Status de fulfillment do pedido de venda (automático)

Novo campo `fulfillment_status` em `sale_orders` (cache) recalculado por view + trigger:

- `pending` — pedido confirmado, ainda sem reserva nem PO
- `backordered` — todas as linhas dependem de PO ainda não recebida (status "Encomendado")
- `purchased` — PO vinculada confirmada (compra feita com sucesso, aguarda chegada)
- `partial` — parte das linhas reservada/disponível, parte ainda em PO
- `ready` — 100% reservado/disponível, pronto para entrega
- `delivered` — picking de saída validado (`done`)

### Regras de cálculo (view `sale_order_fulfillment`)
Para cada SO confirmada, agrega `stock_moves` do picking outgoing + POs com `origin = SO.name`:
- qty_reserved = Σ moves com state `ready/assigned`
- qty_done = Σ moves `done`
- qty_incoming = Σ linhas de PO vinculadas não recebidas
- qty_total = Σ linhas SO

Resultado:
```text
done == total          → delivered
reserved == total      → ready
done+reserved > 0 e incoming > 0 → partial
incoming == total e PO confirmed → purchased
incoming == total e PO draft     → backordered
caso geral              → pending
```

### Trigger
- `AFTER UPDATE` em `stock_moves`, `purchase_orders`, `stock_pickings` → recalcula e grava `sale_orders.fulfillment_status` para o SO afetado (resolvido via `origin`).

### UI
- Badge colorido em `OrderForm` e listas (`SalesOrdersList`) — cores: cinza/âmbar/azul/violeta/verde/esmeralda.
- Filtro por status na lista.

---

## 2. Cronograma de entregas (Calendário + Lista)

Nova rota `/inventory/schedule` com 2 abas:

**Calendário** (mensal/semanal)
- Componente baseado em `react-day-picker` já instalado, com células custom mostrando nº de pickings por dia + cores por estado.
- Click no dia → drawer lateral com pickings desse dia.
- Drag & drop opcional v2 — agora apenas click para reagendar via dialog.

**Lista**
- Tabela de `stock_pickings` com filtros: tipo (incoming/outgoing/internal), armazém, parceiro, estado, intervalo de datas (`scheduled_at`), origem (SO/PO).
- Ações rápidas: abrir, validar, reagendar.

Campo necessário: `stock_pickings.scheduled_at` (verificar; se faltar, adicionar `timestamptz default now()`).

---

## 3. Rastreio do pedido (Timeline vertical)

Nova aba "Rastreio" em `OrderForm` (sale) — componente `OrderTraceability.tsx`:

```text
● Pedido confirmado          SO00012   08/05 14:02
│
├─● Compra criada            PO00045   08/05 14:02   → fornecedor X
│ └─● Compra confirmada      PO00045   08/05 15:10
│   └─● Recebimento          WH/IN/021 12/05 09:30   ✓ done
│
├─● Reserva de stock         3/5 unid.  Stock → Cliente
│
├─● Transferência criada     WH/OUT/088 draft
│ └─○ Validação pendente
│
└─○ Entrega ao cliente       previsto 13/05
```

Fontes: `sale_orders` + `purchase_orders (origin=SO.name)` + `stock_pickings (origin=SO.name OR PO.name)` + `stock_moves` + `record_messages`. Cada nó tem link para abrir o documento e mostra a rota associada (warehouse → location).

Mesma timeline (simplificada) também na PO mostrando o SO de origem.

---

## 4. Filtros avançados no inventário

### A) Nova tela `/inventory/moves` — Movimentos de stock
Lista única de `stock_moves` (entrada/saída/interno) com filtros combinados:
- Intervalo de datas (criação, conclusão)
- Tipo: entrada / saída / interna / ajuste
- Produto, variante, lote
- Parceiro (cliente/fornecedor via picking)
- Armazém / localização origem / destino
- Estado (draft/waiting/ready/done/cancelled)
- Origem (texto: SO/PO/ajuste)
- Export CSV.

### B) Melhorias nos filtros das listas existentes
`InventoryPages.tsx` (Recebimentos, Entregas, Transferências, Ajustes):
- Componente `AdvancedFilters` reutilizável: chips removíveis + popover com data range, parceiro, produto, estado.
- Persistência dos filtros no URL (querystring).

---

## 5. Detalhes técnicos

### Migrações SQL
1. `ALTER TABLE sale_orders ADD COLUMN fulfillment_status text DEFAULT 'pending';`
2. `ALTER TABLE stock_pickings ADD COLUMN IF NOT EXISTS scheduled_at timestamptz DEFAULT now();` (se não existir)
3. `CREATE OR REPLACE VIEW sale_order_fulfillment AS …` (agregação descrita acima)
4. `CREATE FUNCTION recalc_so_fulfillment(_so uuid) … ` — escreve em `sale_orders.fulfillment_status` lendo a view.
5. Triggers `AFTER INSERT/UPDATE` em `stock_moves`, `purchase_orders`, `stock_pickings` que resolvem o SO via `origin` e chamam `recalc_so_fulfillment`.
6. Atualizar `confirm_sale_order` para chamar `recalc_so_fulfillment` no final.
7. Índices: `stock_pickings(scheduled_at)`, `stock_moves(state, picking_id)`, `purchase_orders(origin)`.

### Ficheiros a criar
- `src/modules/inventory/pages/SchedulePage.tsx` (calendário + lista)
- `src/modules/inventory/pages/MovesPage.tsx` (movimentos com filtros)
- `src/modules/inventory/components/AdvancedFilters.tsx` (reutilizável)
- `src/core/orders/OrderTraceability.tsx` (timeline vertical)
- `src/core/orders/FulfillmentBadge.tsx`
- `supabase/migrations/..._sale_fulfillment_schedule.sql`

### Ficheiros a editar
- `src/core/orders/OrderForm.tsx` — adicionar aba "Rastreio" e badge no header
- `src/modules/sales/pages/SalesPages.tsx` — coluna + filtro fulfillment_status
- `src/modules/inventory/pages/InventoryPages.tsx` — integrar `AdvancedFilters` nas listas
- `src/App.tsx` + `src/core/modules/registry.ts` — rotas `/inventory/schedule` e `/inventory/moves`
- `src/core/layout/AppShell.tsx` — entradas de menu

---

## Fora do âmbito
- Drag & drop de reagendamento no calendário (v2).
- Notificações automáticas ao cliente por email a cada mudança de status (pode entrar depois).
- Integração com transportadoras / tracking number externo.
