## Fluxo de Recebimentos com reserva automática para a venda de origem

### Objetivo

Fechar o ciclo **Venda → Compra → Recebimento → Reserva → Entrega** para que, ao chegar mercadoria comprada por causa de uma venda específica, o stock entre e seja **imediatamente reservado para o cliente que disparou a compra**. Inclui uma nova tela de **Recebimentos** dividida em "originados em vendas" e "manuais".

---

### 1. Comportamento de stock por estado

| Momento | Efeito no stock |
|---|---|
| PO confirmada | Picking de entrada criado em estado `ready`. Stock **on-hand não muda** — fica como "previsto de chegada" (já é o que o badge `incoming` da venda mostra). |
| Recebimento validado | Stock entra no armazém (já existe via `validate_picking`). **NOVO:** se o recebimento veio de um PO que originou de uma SO, criar reserva imediata na linha equivalente do picking outgoing dessa SO. |
| Picking outgoing validado | Saída para o cliente (já existe). |

A coluna "Disponível" do produto continua refletindo `quantity − reserved_quantity`, então o cliente que disparou a compra "consome" o stock no momento em que ele chega — exatamente o fluxo descrito (-1 → 0 mas reservado).

---

### 2. Migração SQL

**a) Nova função `reserve_incoming_to_origin_so(_picking uuid)`**

Após validar um picking `incoming` cuja `origin` aponta para um PO, e esse PO foi gerado por uma SO (`purchase_orders.origin = sale_orders.name`):

```text
para cada move feito (quantity_done > 0) no recebimento:
  encontrar move correspondente no picking outgoing da SO (mesmo product_id, state in ('draft','waiting'))
  chamar reserve_for_move(move_outgoing.id) limitado à quantidade recebida
  registrar log no picking outgoing: "Reservado X un. via recebimento WH/IN/..."
```

**b) Patch em `validate_picking`**

No final, se `kind = 'incoming'`, chamar `reserve_incoming_to_origin_so(_picking)`.

**c) Patch em `confirm_purchase_order`**

Garantir que o picking incoming criado herda `origin` do PO (já herda) e que o `scheduled_at` usa `expected_date` da PO quando disponível, para o calendário/cronograma.

---

### 3. Nova tela `/inventory/receipts` — Recebimentos

Card no dashboard de Inventário (já existe "Recebimentos" como contador — virar link clicável) e entrada no menu lateral.

Layout em **2 abas**:

- **Aba "De Vendas"** — `stock_pickings` onde `kind='incoming'` e existe SO cujo `name = (PO da origin).origin`. Mostra colunas: Recebimento, PO, **SO de origem**, Cliente final, Fornecedor, Programado, Estado.
- **Aba "Manuais"** — `kind='incoming'` sem cadeia para SO (origin é PO de reordering, ajuste, ou criação manual). Colunas: Recebimento, PO, Fornecedor, Programado, Estado.

Filtros (via `AdvancedFilters` já reutilizável): estado, intervalo de datas, fornecedor, armazém.

Cada linha abre o `TransferForm` existente.

---

### 4. UI complementar

- **`SmartButtons` no PO**: já lista recebimentos. Adicionar card "Cliente final" quando o PO veio de SO, com link para a SO.
- **`TransferForm` (recebimento)**: ao validar, se reservou para uma SO, mostrar toast "Recebido e reservado para SO XXXX".
- **Badge na lista de recebimentos**: chip "↳ Venda 0012" quando vier de SO, em cinza neutro quando manual.

---

### 5. Arquivos

**Migração**
- `supabase/migrations/..._receipts_reserve_to_so.sql` — função `reserve_incoming_to_origin_so` + patch em `validate_picking` + patch em `confirm_purchase_order` (scheduled_at).

**Novos**
- `src/modules/inventory/pages/ReceiptsPage.tsx` — abas De Vendas / Manuais.

**Editados**
- `src/App.tsx` + `src/core/modules/registry.ts` — rota `/inventory/receipts`.
- `src/core/layout/AppShell.tsx` — entrada de menu "Recebimentos".
- `src/modules/inventory/pages/InventoryPages.tsx` — card "Recebimentos" do dashboard vira link.
- `src/core/orders/SmartButtons.tsx` — card "Cliente final" no PO.
- `src/modules/inventory/pages/TransferForm.tsx` — toast quando recebimento reserva para SO.

---

### Fora do escopo
- Reserva parcial cross-warehouse (assume mesmo armazém da SO).
- Notificação automática ao cliente quando o stock chega (pode entrar depois via `module_events`).
