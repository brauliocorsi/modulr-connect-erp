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
