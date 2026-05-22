# F28-FIN — Entrega B.2: Plano de fecho

## Estado já no repo (não refazer)

- ReceivablesPage v2 com tabs (Todos/Balcão/Entregas/Banco/Vencidos/Pagos), filtros de origem/método/vendedor/loja, badge de vencido/conciliado.
- BillForm v2 com locks por estado (paid/cancelled), seletor de plano de contas, origem (PO/recurring/manual), guarda total ≥ pago.
- CostCentersPage em `/finance/cost-centers` com CRUD via `cost_center_upsert` / `cost_center_archive`, item no menu.
- RPCs B.2 já criadas: `cost_center_upsert`, `cost_center_archive`, `supplier_bill_set_attachments`, `supplier_payment_set_attachments`, overload antiga de `supplier_payment_register` removida.
- Zero-bypass: `rg` retorna 0 hits nas tabelas financeiras core.
- PayablesList, RegisterSupplierPaymentDialog, RecurringExpenseDialog com CC/conta/diário (Entrega B fundação).
- Relatórios: `.lovable/F28-FIN-B-final.md` existente (será atualizado, não reescrito do zero).

## O que falta para fechar B.2

A iteração anterior fez UI + RPCs + zero-bypass mas a bateria de testes vitest exigida no ponto 4 da spec não está completa para as alterações B/B.2. Esta iteração é só testes + verificação + relatório.

### 1. Atualizar/criar testes vitest

Ficheiros a tocar (apenas testes — sem mexer em UI/RPC):

**`src/modules/finance/pages/__tests__/PayablesList.test.tsx`** (atualizar)
- filtro por origem (manual / purchase_order / recurring_expense)
- filtro por centro de custo
- filtro por conta (plano de contas)
- filtro rápido "próximos 7 dias"

**`src/modules/finance/components/__tests__/RegisterSupplierPaymentDialog.test.tsx`** (atualizar)
- ao confirmar, `supabase.rpc('supplier_payment_register', ...)` recebe `_cost_center_id`, `_account_id`, `_journal_id` conforme seleção.

**`src/modules/finance/pages/__tests__/ReceivablesPage.test.tsx`** (atualizar)
- tabs renderizam todas as 6 chaves
- filtro origem reduz linhas
- filtro método/vendedor/loja
- linha vencida ganha badge `overdue`; linha de origem `banco` mostra atalho de conciliação

**`src/modules/finance/pages/__tests__/BillForm.test.tsx`** (atualizar)
- estado `paid` → inputs financeiros desactivados
- estado `cancelled` → inputs desactivados
- estado `partial` → tentativa de total < `amount_paid` bloqueada (validação + toast)
- guardar chama `supplier_bill_update` com `account_id` e `cost_center_id`
- pagar chama `supplier_payment_register` com `_journal_id` e `_account_id`

**`src/modules/finance/pages/__tests__/RecurringExpensesPage.test.tsx`** (atualizar — apenas a porção UI)
- "Gerar conta" chama `recurring_expense_generate_bill` (a assertiva real do source/CC/account é coberta pelos self-tests SQL F28-FIN-A, não duplicar aqui).

**`src/modules/finance/pages/__tests__/CostCentersPage.test.tsx`** (criar)
- render lista (mock `from('cost_centers').select`)
- criar chama `cost_center_upsert` sem `id`
- editar chama `cost_center_upsert` com `id`
- arquivar chama `cost_center_archive`
- search filtra por código/nome

Todos os testes usam o padrão já existente: mock de `@/integrations/supabase/client` com `from`/`rpc` chains, `render` com `MemoryRouter` quando há `<Link>`. Sem novas dependências.

### 2. Execução

```
bunx vitest run src/modules/finance
```

Esperado: verde. Se algum self-test SQL referenciado na spec (`_test_phase20_financial_core`, `_test_phase24_finance_core_rebuild`, `_test_phase24b2_store_cash_delivery_guardrails`) quebrar quando invocado, parar e reportar (regra STOP).

### 3. Re-verificar zero-bypass

```
rg -n "from\(['\"](supplier_bills|supplier_bill_lines|supplier_payments|customer_payments|sale_payment_schedules|recurring_expenses|cost_centers|chart_of_accounts|bank_reconciliation_lines|cash_movements)['\"]\)\.(insert|update|upsert|delete)" src/modules src/core
```

Esperado: 0 hits (já está). Se houver regressão, migrar para RPC.

### 4. Atualizar relatório

Editar `.lovable/F28-FIN-B-final.md` adicionando secção "B.2 — fecho" com:
- testes novos/atualizados e contagem
- saída do zero-bypass sweep
- resultado dos self-tests SQL
- backlog Entrega C (notificações, dashboard v2, gráficos, OCR, SAF-T, aprovação, IA, importação bancária v2).

## Fora de scopo

Não tocar em: RPCs financeiros, BillForm/ReceivablesPage/PayablesList/CostCentersPage UI, conciliação A, F24-B core, qualquer feature da Entrega C.

## Riscos / STOP

- Se um teste expor bug real de regra financeira (ex.: total < pago não bloqueado), parar e reportar antes de mascarar com mock.
- Se self-test SQL quebrar, reportar causa raiz sem patch.
