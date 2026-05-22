# F28-FIN — Auditoria Financeira

## Matriz por área

| Área | Tabela / RPC | UI atual | Gap | Ação |
|---|---|---|---|---|
| Contas a receber | `customer_payments`, `sale_payment_schedules` | `/finance/receivables` | Sem segmentação por origem (loja/entrega/banco), sem coluna conta/CC, sem filtro confirmado | **Entrega B**: tabs + filtros (origem, método, confirmado), colunas account/CC |
| Contas a pagar | `supplier_bills`, `supplier_payments` (cost_center_id ✅) | `/finance/payables` | Falta `account_id`, falta escolha de conta/CC no registo de pagamento, sem filtro origem | **Entrega B**: filtros (origem, CC, conta), dialog c/ CC+account_id |
| Recebimentos vendas (loja) | `customer_payments` via `register_customer_payment` | `/finance/payments` | OK | OK |
| Recebimentos entregas | `customer_payments` + `cash_movements` + `delivery_route_cash_closure` | `/finance/handovers` | OK | OK |
| Conciliação bancária | `bank_reconciliation_batches/lines` | `/finance/reconciliation` | Não suporta importação de extrato (upload CSV/XLS), só lista pendentes | **F28**: tabela `bank_statement_imports/lines` + wizard upload/mapeamento (**implementado nesta entrega**) |
| Conciliação confirm | RPC `bank_reconciliation_confirm_match` | — | Nova | **Implementado nesta entrega** |
| Caixa físico | `cash_sessions`, `cash_movements` | `/cashbox` | OK | OK |
| Contas bancárias / diários | `account_journals` | `/finance/journals` | OK; falta IBAN, saldo inicial, conta contábil | **Entrega C**: campos extra |
| Métodos pagamento | `payment_methods` | `/finance/methods` | OK | OK |
| Centros de custo | `cost_centers` | `/finance/cost_centers` | OK; já aplicado em customer_payments/supplier_bills/cash_movements; faltava em recurring_expenses | **F28**: coluna adicionada |
| Plano de contas | `chart_of_accounts` | — | Tabela inexistente | **F28**: tabela + RPCs + UI `/finance/chart-of-accounts` (**implementado**) |
| Despesas fixas | `recurring_expenses` | `/finance/recurring` | Faltava `cost_center_id`, `account_id`, `journal_id` | **F28**: colunas adicionadas; UI fica para Entrega B |
| Notificações vencimento | — | Dashboard | Sem cards de vencidos próximos | **Entrega C** |
| Dashboard financeiro | `FinanceDashboard` | `/finance` | Existe básico | **Entrega C**: segmentar vendas/entregas/banco/caixa |
| Relatórios | — | — | Inexistente | **F28**: landing `/finance/reports` com 8 relatórios (**implementado** — landing + 1º relatório CSV) |
| Menu Financeiro | `GlobalSidebar` | linear 12 itens | Sem agrupamento por função | **F28**: reorganizado em blocos (**implementado**) |

## Fluxos validados

1. **Venda → AR:** `sale_orders` → `sale_payment_schedules` (gerado por RPC) → `customer_payments` (via `register_customer_payment`). OK.
2. **Entrega → recebimento em rota:** picking → `cash_movements` no caixa de entrega → handover → `customer_payments`. OK.
3. **Banco → conciliação:** hoje só manual via `bank_reconciliation_lines`. **Gap**: sem importação extrato — coberto nesta entrega.
4. **Compra → AP:** `purchase_orders` → `supplier_bills` (`supplier_bill_create`) → `supplier_payments` (`supplier_payment_register`). OK.
5. **Pagamento fornecedor:** atualiza `supplier_bills.amount_paid` e estado via trigger. OK.
6. **CC no movimento:** `cost_center_id` está em `customer_payments`, `supplier_bills/payments`, `cash_movements`. Falta exposição em UI de payables/receivables (Entrega B).
7. **Conta financeira:** `journal_id` em `customer_payments`, `supplier_payments`. OK. Falta `account_id` (plano de contas) — coberto.

## Conclusão

Infraestrutura já bastante rica. F28 introduz **plano de contas** (peça em falta) e **importação de extrato bancário** (peça em falta), reorganiza o menu e prepara o terreno para as melhorias de AP/AR/Dashboards/Relatórios que ficam para Entrega B e C.
