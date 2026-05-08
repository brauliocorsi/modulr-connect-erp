
## Objetivo

Fechar o ciclo da venda em duas dimensões independentes — **Fulfillment** (separação/entrega ao cliente) e **Pagamento** (sinal/parcial/quitado) — e introduzir um módulo financeiro leve com **diários/contas**, **schedule de pagamentos por SO** e **registo de recebimentos**. Sem bloquear entrega, apenas avisando.

---

## 1. Revisão do fluxo atual e correções de status

Auditoria das transições para garantir consistência:

| Evento | SO.state | SO.fulfillment_status | PO.state | Picking IN | Picking OUT |
|---|---|---|---|---|---|
| SO criada | draft | pending | — | — | — |
| SO confirmada (stock ok) | confirmed | ready | — | — | waiting → ready (reservado) |
| SO confirmada (faltou stock, gera PO) | confirmed | backordered | draft | — | waiting |
| PO confirmada | confirmed | purchased | confirmed | ready | waiting |
| Recebimento validado | confirmed | partial→ready | confirmed | done | ready (auto-reservado) |
| Picking OUT validado (parcial) | confirmed | partial | — | — | parcial |
| Picking OUT validado (total) | **done** | **delivered** | — | — | done |
| SO cancelada | cancelled | cancelled | — | — | cancelled |

**Correções a fazer no `recalc_so_fulfillment`:**
- adicionar caso explícito quando todos os pickings outgoing estão `done` → marcar SO como `state='done'` automaticamente (hoje só atualiza badge).
- novo valor `delivered` distinto de `done` financeiro: `delivered` = mercadoria entregue, `done` = entregue **e** quitado.

---

## 2. Modelo de pagamentos (schedule por SO + diários)

### Novas tabelas

**`account_journals`** — diários/contas onde o dinheiro entra
- `code`, `name`, `type` ('cash' | 'bank' | 'card' | 'other'), `currency`, `active`

**`payment_methods`** — meios aceites (Dinheiro, MB Way, Transferência, Multibanco, Cartão…)
- `code`, `name`, `default_journal_id`, `active`

**`sale_payment_schedules`** — cronograma planejado de uma venda
- `order_id` (FK sale_orders), `sequence`, `label` ('Sinal', 'Saldo na entrega'), `due_kind` ('on_confirm' | 'on_delivery' | 'fixed_date' | 'days_after_confirm'), `due_date`, `due_days`, `percent`, `amount` (calculado), `state` ('pending' | 'partial' | 'paid')

**`customer_payments`** — recebimentos efetivos
- `name` (sequência PAY/…), `partner_id`, `order_id` (FK sale_orders, nullable para recebimento avulso), `schedule_id` (nullable), `payment_date`, `amount`, `method_id`, `journal_id`, `reference`, `notes`, `state` ('draft' | 'posted' | 'cancelled'), `created_by`

### Funções SQL

- `apply_payment(_payment uuid)` — soma ao schedule mais antigo pendente do SO, atualiza estados (`partial`/`paid`), recalcula `payment_status` do SO, registra `record_messages`.
- `recalc_payment_status(_so uuid)` — campo `sale_orders.payment_status` ∈ `unpaid | deposit_paid | partial | paid | overpaid`, baseado em `sum(payments) vs amount_total` e schedules.
- `seed_default_schedule(_so uuid)` — quando SO é confirmado e não tem schedule, criar 1 linha "100% na entrega" como default.
- Patch em `confirm_sale_order`: chama `seed_default_schedule`.

### Sequências
Adicionar `customer_payment` na `number_sequences` (prefixo `PAY/`).

---

## 3. UI

### `OrderForm` (Vendas) — nova aba **"Pagamentos"**
- **Cabeçalho**: badge `payment_status` ao lado de `FulfillmentBadge`.
- **Schedule editável** (antes de confirmar): linhas com %/valor, vencimento (na confirmação / na entrega / data fixa / X dias após confirmação), label.
- **Recebimentos** (após confirmar): tabela de `customer_payments` + botão "Registar recebimento" (dialog: data, valor, método, diário, ref, notas). Linha mostra a qual schedule alocou.
- **Resumo financeiro**: Total / Recebido / Em aberto / Próximo vencimento.
- **Aviso (não bloqueia)**: ao validar picking outgoing com saldo em aberto, toast laranja "Cliente ainda deve X — confirme entrega mesmo assim?".

### `TransferForm` (saída ao cliente)
- Banner com `payment_status` da SO de origem.
- Botão "Registar recebimento agora" (atalho que abre dialog de payment já preenchido com saldo em aberto e método 'Dinheiro' por defeito) — útil para o cenário "paga na entrega".

### Novo módulo **Financeiro** (`/finance`)
- **Recebimentos** (`/finance/payments`) — lista global, filtros por método/diário/data, abas "Por Pagar (schedules vencidos)" e "Recebidos".
- **Diários** (`/finance/journals`) — CRUD.
- **Métodos de Pagamento** (`/finance/methods`) — CRUD.
- **Extrato por diário** (`/finance/journals/:id`) — lista de movimentos com saldo.

### `SmartButtons`
- Na SO: card "Recebimentos" (count + total recebido / total).
- Em recebimentos: link para SO de origem.

### Dashboard de Vendas
- Cards "A receber esta semana", "Vencidos".

---

## 4. Permissões

Novo módulo `finance` no enum `app_module`, entidades `journals`, `methods`, `payments`, `schedules` com ações padrão. Grupos `finance_user` e `finance_manager`. `sales_user` ganha permissão de criar `payments` (registar recebimento na SO dele).

---

## 5. Detalhes técnicos

```text
sale_orders
  ├─ payment_status (novo)        ── recalculado por trigger
  ├─ sale_payment_schedules[]     ── plano
  └─ customer_payments[]          ── execução
                                       └─ journal_id ──► account_journals
                                       └─ method_id  ──► payment_methods
```

- **Triggers**: `AFTER INSERT/UPDATE/DELETE` em `customer_payments` → `recalc_payment_status(order_id)`.
- **RLS**: ver/criar `customer_payments` da própria SO via `has_permission('finance','payments',…)` ou ser `salesperson_id` da SO.
- **Idempotência**: `apply_payment` usa `state='draft'→'posted'` para evitar dupla aplicação.
- **Multi-moeda**: fora do escopo desta fase; herda `currency` da SO.

---

## 6. Arquivos

**Migração**
- `..._payments_module.sql` — tabelas, enums, sequence, RLS, funções, patch em `confirm_sale_order` e `recalc_so_fulfillment`, novo módulo `finance` em permissões.

**Novos**
- `src/modules/finance/pages/PaymentsPage.tsx`
- `src/modules/finance/pages/JournalsList.tsx` + `JournalForm.tsx`
- `src/modules/finance/pages/MethodsList.tsx` + `MethodForm.tsx`
- `src/modules/finance/components/RegisterPaymentDialog.tsx`
- `src/core/orders/PaymentStatusBadge.tsx`
- `src/core/orders/PaymentsTab.tsx` (schedule + recebimentos para usar no OrderForm)

**Editados**
- `src/App.tsx` + `src/core/modules/registry.ts` + `src/core/layout/AppShell.tsx` — rotas e menu Financeiro.
- `src/core/orders/OrderForm.tsx` — abas (Linhas / Pagamentos / Atividade), badge novo, banner de aviso.
- `src/core/orders/SmartButtons.tsx` — card Recebimentos.
- `src/modules/inventory/pages/TransferForm.tsx` — banner + atalho de recebimento.
- `src/modules/sales/pages/SalesPages.tsx` — coluna "Pagamento" na lista.

---

## Fora do escopo
- Faturas/NF-e/recibo PDF (próxima fase).
- Conciliação bancária automática.
- Devoluções/estornos de pagamento (manual via `state='cancelled'` por agora).
- Multi-moeda e taxas de câmbio.
