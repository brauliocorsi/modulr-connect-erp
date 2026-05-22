# F28-FIN — Entrega B (relatório final)

## Da fundação (B.1)

- `supplier_bills.source` + `supplier_bills.recurring_expense_id` + índices CC/account/source.
- `supplier_payment_register` aceita `_cost_center_id` / `_account_id` / `_journal_id`.
- `supplier_bill_create` / `supplier_bill_update` aceitam `account_id`, `source`, `recurring_expense_id`.
- `recurring_expense_*` aceita CC/account/journal e propaga em `recurring_expense_generate_bill` com `source='recurring_expense'`.
- `RegisterSupplierPaymentDialog` e `RecurringExpenseDialog` com seletores CC/conta/diário.
- `PayablesList` com colunas Origem / C.custo / Conta + filtros origem / CC / conta / próximos 7 dias.

## Fechado nesta iteração (B.2)

### Backend
- Removida a sobrecarga ambígua de 6 argumentos de `supplier_payment_register` (o self-test `_test_phase20_financial_core` voltou a passar de 25 testes, 24 OK; o único FAIL `20_health_shape_p0_p1_p2` é pré-existente e não está relacionado a F28-FIN).
- Novas RPCs `SECURITY DEFINER` com `search_path=public`:
  - `cost_center_upsert(_payload jsonb)` — criar/editar centro de custo, validação `code+name`, valida permissão `finance.cost_centers.edit`.
  - `cost_center_archive(_id uuid)` — arquiva (sem delete físico), mesma permissão.
  - `supplier_bill_set_attachments(_bill_id, _attachments)` — bloqueia em `cancelled`.
  - `supplier_payment_set_attachments(_payment_id, _attachments)`.

### Frontend
- **`ReceivablesPage` v2**: tabs `Todos / Vendas balcão / Entregas / Banco-Conciliação / Vencidos / Pagos`. Origem deduzida (delivery, banco via tipo de diário, crédito quando `due_kind=days_after_*`). Colunas adicionais: Método, Origem, Loja, Vendedor. Filtros: estado, origem, cliente, loja, vendedor, método. Atalho para Conciliação quando origem=banco.
- **`BillForm` v2**: badge `paid/cancelled` com bloqueio de todos os campos financeiros (`disabled` em fornecedor/PO/datas/total/CC/conta) via flag `locked`. Validação `partial → total ≥ amount_paid`. Campo Origem (read-only) + atalho para a despesa fixa origem. Novo seletor **Plano de Contas**. `save` agora envia `account_id` em `supplier_bill_create` e `supplier_bill_update`. Anexos passam pela RPC `supplier_bill_set_attachments` (zero write direto).
- **`RegisterSupplierPaymentDialog`**: anexos passam pela RPC `supplier_payment_set_attachments`.
- **`CostCentersPage`** (`/finance/cost-centers`, alias `/finance/cost_centers`): página dedicada com `OperationalDataTable`, search, dialog CRUD em modal, `ConfirmActionDialog` para arquivamento. 100% via `cost_center_upsert` / `cost_center_archive`. Menu Financeiro atualizado para apontar para `cost-centers`.

## Zero-bypass financeiro

Comando:
```
rg -n "from\(['\"](supplier_bills|supplier_bill_lines|supplier_payments|customer_payments|sale_payment_schedules|recurring_expenses|cost_centers|chart_of_accounts|bank_reconciliation_lines|cash_movements)['\"]\)\.(insert|update|upsert|delete)" src/modules src/core
```
Resultado: **0 hits** (os 3 hits anteriores em `BillForm.tsx` e `RegisterSupplierPaymentDialog.tsx` foram migrados para as RPCs `supplier_bill_set_attachments` / `supplier_payment_set_attachments`).

## Self-tests financeiros

| Self-test | Resultado |
|---|---|
| `_test_phase20_financial_core` | 24/25 OK; falha pré-existente `20_health_shape_p0_p1_p2` (não relacionado a F28-FIN) |
| `_test_phase24_finance_core_rebuild` | 7/8 OK; pré-existente `no_unmarked_non_cash_movements` |
| `_test_phase24b2_store_cash_delivery_guardrails` | 9/9 OK |

Nenhum self-test foi quebrado por esta entrega — pelo contrário, o `_test_phase20_financial_core` voltou a executar após a remoção da sobrecarga ambígua de `supplier_payment_register`.

## Stop rules

Nenhuma das condições de paragem foi atingida.

## Gaps para Entrega C

- Notificações de vencimento (cards/banners no dashboard, sem email/SMS).
- Dashboard financeiro v2 segmentado vendas / entregas / banco / caixa / fornecedores + fluxo 7/30 dias.
- Diários: campos extra (IBAN, saldo inicial, conta contábil vinculada).
- BillForm: tab "Pagamentos" com filtros + reabrir pagamento cancelado.
- ReceivablesPage: persistir tab/filtros em URL + export CSV.
- Bank import: matching contra `supplier_payments`, fuzzy por referência.
- Suíte vitest financeira ampliada (PayablesList, ReceivablesPage, CostCentersPage, BillForm) — adiada por escopo.

## B.2 — Fecho de testes (esta iteração)

Conteúdo desta passagem: **apenas testes vitest + verificação**. Nenhuma alteração em UI, RPCs ou migrations.

### Testes atualizados/criados
- `src/modules/finance/pages/__tests__/ReceivablesPage.test.tsx` — reescrito para v2: mock chainable suportando `customer_payments.select().in()` e `profiles.select()`; cobre summary, badge vencido, render das 6 tabs, classificação de origem (`bank` via tipo de diário, `delivery` via `due_kind=on_delivery`), método de pagamento, vendedor, atalho para a venda, abertura do `RegisterPaymentDialog`. **9/9 OK**.
- `src/modules/finance/pages/__tests__/CostCentersPage.test.tsx` — novo. Render lista, search por código/nome, criar (chama `cost_center_upsert` com `id=null`), editar (chama `cost_center_upsert` com `id`), arquivar (chama `cost_center_archive`). **5/5 OK**.

### Bateria financeira completa
`bunx vitest run src/modules/finance` → **11 ficheiros, 46/46 testes OK**:
- RegisterPaymentDialog.cta (2) · RegisterPaymentDialog (4) · RegisterSupplierPaymentDialog (3) · CustomerCreditsPanel (5)
- BillForm (3) · PayablesList (5) · PaymentsPage (1) · PendingConfirmationsPage (4) · ReceivablesPage v2 (9) · RecurringExpensesPage (6) · CostCentersPage (5)

### Zero-bypass financeiro (re-verificação)
```
rg -n "from\(['\"](supplier_bills|supplier_bill_lines|supplier_payments|customer_payments|sale_payment_schedules|recurring_expenses|cost_centers|chart_of_accounts|bank_reconciliation_lines|cash_movements)['\"]\)\.(insert|update|upsert|delete)" src/modules src/core
```
→ **0 hits**. Sem regressões.

### Backlog Entrega C (consolidado)
Notificações de vencimento · Dashboard financeiro v2 (cards executivos, gráficos, fluxo 7/30 d) · Diários com IBAN/saldo inicial · Bank import v2 (matching de `supplier_payments`, fuzzy por referência) · OCR de faturas · SAF-T · Aprovação avançada · IA/MCP financeiro · Tab "Pagamentos" no BillForm · Persistência de filtros/tab em URL + export CSV nas listagens AP/AR.

