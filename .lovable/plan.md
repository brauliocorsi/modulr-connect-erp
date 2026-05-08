## Objetivo

Tornar o fluxo de pagamentos mais simples e prático: cronograma fácil de editar, métodos de pagamento dinâmicos com confirmação automática ou pendente, controle real de **Caixas de loja** (com sessão diária e sangria), status manual de **Faturação** na venda, e expandir o módulo **Financeiro** com Contas a Pagar, Contas a Receber e Centro de Custos.

---

## 1. Cronograma de pagamentos — versão simplificada

Hoje a aba "Pagamentos" obriga a definir % e somar 100%. Vamos simplificar:

- **Modo padrão "automático"**: ao confirmar a venda, cria-se 1 linha "Total a receber" com valor = `amount_total` e vencimento "na entrega". Sem necessidade de o utilizador mexer.
- **Quando regista um pagamento parcial**, o sistema entende automaticamente como **sinal**: marca o schedule como `partial`, cria/ajusta uma 2ª linha "Saldo" com o valor restante, vencimento "na entrega" (ou data definida).
- **Edição manual continua disponível** numa secção "Avançado": dividir em N parcelas, escolher datas, % ou valores absolutos. Validação relaxada (não exige soma exata 100%, ajusta a última linha).
- **Datas**: cada parcela tem `due_date` calculada (na confirmação → data confirmação; na entrega → data prevista da entrega; data fixa; X dias após). Mostradas em coluna "Vence em".

---

## 2. Métodos de pagamento dinâmicos com regra de confirmação

Adicionar a `payment_methods`:

- `confirmation_mode` ∈ `auto` | `pending_finance` | `pending_delivery`
  - **auto** (Dinheiro): pagamento entra `state='posted'` direto, alimenta caixa/diário.
  - **pending_finance** (Multibanco, Transferência): entra `state='pending'`, aparece em **Financeiro › Confirmações pendentes** para o financeiro validar (botão "Confirmar recebimento").
  - **pending_delivery** ("Pagar na entrega"): entra `state='pending_delivery'`, aparece como tarefa no picking de saída — entregador escolhe método real (dinheiro/MB) no momento e confirma.
- `feeds_cash_session` (boolean): se true e método=`auto`, lança movimento de **entrada** na sessão de caixa aberta da loja.
- `requires_reference` (boolean): obriga preencher referência (útil para transferência).

UI em `/finance/methods`: utilizador define livremente novos métodos com estes flags. Sem tipos hardcoded.

Estados novos em `customer_payments.state`: `pending` | `pending_delivery` | `posted` | `cancelled`. `recalc_payment_status` só conta `posted`.

---

## 3. Caixas de loja (módulo novo)

### Modelo

- **`cash_registers`** — caixa por loja: `warehouse_id`, `name`, `journal_id` (diário cash associado), `active`.
- **`cash_sessions`** — sessão diária: `register_id`, `opened_at`, `opened_by`, `opening_balance`, `closed_at`, `closed_by`, `closing_balance_theoretical`, `closing_balance_counted`, `difference`, `state` ('open'|'closed').
- **`cash_movements`** — movimentos: `session_id`, `kind` ('sale'|'withdrawal'|'expense'|'bonus'|'advance'|'sangria'|'deposit'|'opening'), `amount` (positivo=entrada, negativo=saída), `reference` (nº do payment, descrição), `partner_id`, `user_id` (vendedor), `payment_id` (FK opcional), `notes`, `created_at`.

### Regras

- **Abertura**: ao abrir nova sessão, `opening_balance` = `closing_balance_counted` da última sessão fechada (ou 0 se primeira). Lança movimento `opening`.
- **Fecho**: utilizador conta dinheiro, sistema calcula diferença vs teórico, regista e fecha. Permite **sangria parcial** (saída tipo `sangria` que reduz saldo mas não fecha) ou **sangria total** (sangria + fecho com 0).
- **Entrada automática**: trigger em `customer_payments` quando `state='posted'`, `method.feeds_cash_session=true` e existe sessão aberta na loja do SO → cria `cash_movement` (kind='sale').
- **Saídas manuais**: dialog para registar `withdrawal`/`expense`/`bonus`/`advance` com valor, motivo, beneficiário.
- **Vendas por vendedor**: relatório agregado por `user_id` na sessão.

### UI

- `/finance/cash` — lista de caixas (uma por loja).
- `/finance/cash/:registerId` — sessões (abertas/fechadas), botão "Abrir sessão" / "Fechar sessão".
- `/finance/cash/sessions/:id` — detalhes da sessão: saldo atual, lista de movimentos com filtro por tipo/vendedor, botões "Registar saída", "Sangria", "Fechar".

---

## 4. Faturação no SO (manual, simples)

Adicionar a `sale_orders`:
- `invoice_status` ∈ `not_invoiced` | `invoiced` (default `not_invoiced`)
- `invoice_number` (text, opcional)
- `invoice_date` (date, opcional)
- `invoice_notes` (text)

UI:
- **Badge** "Faturado" / "Não faturado" no cabeçalho do SO e coluna na lista de vendas.
- Botão **"Marcar como faturado"** abre dialog com nº da fatura (Invoice Express) + data + notas. Fica preparado para futuro cruzamento via API.
- Botão **"Reverter faturação"** para correções.

---

## 5. Financeiro completo — Contas a Pagar, Receber e Centro de Custos

### Centro de Custos (`cost_centers`)
- `code`, `name`, `parent_id`, `active`. Estrutura em árvore.
- Campo `cost_center_id` em: `customer_payments`, `supplier_bills`, `cash_movements`, `purchase_orders`.

### Contas a Pagar (`supplier_bills` + `supplier_payments`)
- **`supplier_bills`**: `name` (BILL/…), `partner_id`, `purchase_order_id` (opcional), `bill_date`, `due_date`, `amount_total`, `amount_paid`, `state` (draft/posted/paid/cancelled), `cost_center_id`, `notes`, `reference`.
- **`supplier_payments`**: `name` (SPAY/…), `bill_id`, `payment_date`, `amount`, `method_id`, `journal_id`, `state`, `reference`.
- Triggers análogos a customer (recalc state da bill).
- Página `/finance/payables` — abas "A vencer", "Vencidas", "Pagas". CRUD de bills, registar pagamento.

### Contas a Receber
- Já temos `customer_payments` + `sale_payment_schedules`. Adicionar página `/finance/receivables` com:
  - Lista global de schedules: filtros por estado, vencimento, cliente.
  - Abas "A vencer esta semana", "Vencidos", "Recebidos".
  - Atalho "Registar recebimento" inline.

### Confirmações pendentes
- `/finance/pending` — lista de `customer_payments` com `state='pending'` (multibanco/transferência aguardando confirmação). Botão "Confirmar" → muda para `posted`.

### Estrutura do menu Financeiro

```
Financeiro
├─ Dashboard          (resumo: a receber semana, a pagar semana, caixas abertas)
├─ Recebimentos       (customer_payments)
├─ A Receber          (schedules)
├─ Confirmações       (pending)
├─ Contas a Pagar     (bills)
├─ Pagamentos a fornec (supplier_payments)
├─ Caixas             (cash_registers + sessions)
├─ Diários            (account_journals)
├─ Métodos            (payment_methods)
└─ Centros de Custo   (cost_centers)
```

---

## 6. Integração com pickings (entregador)

No `TransferForm` outgoing:
- Se SO tem schedule pendente e SO marcou método "Pagar na entrega" (ou cliente escolheu), o picking mostra **card destacado**: "Receber X € do cliente".
- Botão "Registar recebimento agora" abre `RegisterPaymentDialog` pré-preenchido com saldo em aberto. Entregador escolhe método (Dinheiro/MB) no ato. Se Dinheiro → entra direto no caixa da loja; se MB → fica `pending_finance`.

---

## 7. Permissões

Novas entidades no módulo `finance`:
- `cash_registers`, `cash_sessions`, `cash_movements` — `inventory_user`/`sales_user` podem ver/operar a sessão da sua loja; `finance_manager` controla todas.
- `bills`, `supplier_payments`, `cost_centers` — `finance_user` view/edit, `finance_manager` full.
- `pending` confirmations — `finance_user`.

---

## 8. Diagrama (ASCII)

```text
sale_orders
  ├─ invoice_status (novo)
  ├─ payment_status (existente)
  ├─ schedules ──► customer_payments ──► payment_methods (.confirmation_mode)
  │                       │                       │
  │                       └─► [auto+feeds_cash] ──► cash_movements ──► cash_sessions ──► cash_registers
  │                       │
  │                       └─► [pending] aguarda Confirmações
  │
purchase_orders ──► supplier_bills ──► supplier_payments ──► journals
                          │
                          └─► cost_centers
```

---

## 9. Detalhes técnicos

- **Migração 1 (pagamentos+caixas)**: alterações em `payment_methods`/`customer_payments` (novos campos+estados), `sale_orders` (invoice fields), funções `recalc_payment_status` (só posted), `auto_seed_partial_balance_schedule`, novas tabelas `cash_registers`/`cash_sessions`/`cash_movements` + triggers + RLS, sequence `bill`, `cash_movement`.
- **Migração 2 (AP+CC)**: `cost_centers`, `supplier_bills`, `supplier_payments` + triggers + RLS, novas entidades em permissões, seeds de grupos.
- **Trigger crítico**: `tg_payment_to_cash` em `customer_payments` AFTER INSERT/UPDATE → se `state='posted'` e método tem `feeds_cash_session`, encontra sessão aberta da loja (`warehouse_id` da SO) e insere `cash_movement`. Se `state='cancelled'`, estorna.
- **Função**: `confirm_pending_payment(_id uuid)` — muda `pending`→`posted`, dispara trigger.
- **Função**: `open_cash_session(_register, _opening?)` — usa fecho anterior como abertura.
- **Função**: `close_cash_session(_session, _counted)` — calcula teórico via SUM(movements), grava diferença.
- Reescrever `seed_default_schedule` para criar 1 linha "Total a receber" em vez de exigir UI.

---

## 10. Arquivos

**Migrações** (2):
- `..._payments_v2_and_cash.sql`
- `..._payables_costcenters.sql`

**Novos**:
- `src/modules/finance/pages/CashRegistersList.tsx`, `CashRegisterDetail.tsx`, `CashSessionDetail.tsx`
- `src/modules/finance/components/OpenSessionDialog.tsx`, `CloseSessionDialog.tsx`, `CashMovementDialog.tsx`
- `src/modules/finance/pages/ReceivablesPage.tsx`, `PendingConfirmationsPage.tsx`
- `src/modules/finance/pages/PayablesList.tsx`, `BillForm.tsx`, `RegisterSupplierPaymentDialog.tsx`
- `src/modules/finance/pages/CostCentersList.tsx`, `CostCenterForm.tsx`
- `src/modules/finance/pages/FinanceDashboard.tsx`
- `src/core/orders/InvoiceStatusBadge.tsx`, `MarkInvoicedDialog.tsx`

**Editados**:
- `src/App.tsx`, `src/core/modules/registry.ts`, `src/core/layout/AppShell.tsx` — rotas e menu Financeiro reorganizado.
- `src/core/orders/PaymentsTab.tsx` — modo simplificado (cronograma só aparece em "Avançado"), auto-criação de schedule de saldo após pagamento parcial.
- `src/core/orders/OrderForm.tsx` — InvoiceStatusBadge + ações de faturação.
- `src/modules/sales/pages/SalesPages.tsx` — colunas Pagamento e Faturação.
- `src/modules/finance/components/RegisterPaymentDialog.tsx` — usar `confirmation_mode` do método para definir estado inicial.
- `src/modules/finance/pages/FinancePages.tsx` (Methods/Journals) — campos novos no form de método.
- `src/modules/inventory/pages/TransferForm.tsx` — card de cobrança na entrega.

---

## Fora do escopo
- Integração real com Invoice Express (apenas campos manuais agora).
- Conciliação bancária automática.
- Multi-moeda nos diários.
- Relatórios contábeis fiscais (DRE, balanço).
