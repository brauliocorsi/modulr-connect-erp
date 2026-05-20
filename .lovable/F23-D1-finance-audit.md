# F23-D1 — Auditoria Financeiro Frontend

| Página | Problema | Prioridade | Ação |
|---|---|---|---|
| ReceivablesPage | Sem filtros reais (apenas tabs), badges inline ad-hoc, sem summary cards | Alta | **Feito** — OperationalDataTable + filtros (estado/cliente/vencimento) + SummaryCards + OperationalStatusBadge |
| PayablesList | Sem filtros, sem ações inline de pagamento/cancelamento, badges crus | Alta | **Feito** — OperationalDataTable + filtros + SummaryCards + register/cancel via RPC |
| PendingConfirmationsPage | Rejeição sem motivo, sem loading por botão | Alta | **Feito** — Dialog de rejeição com motivo obrigatório, loading isolado |
| ReconciliationPage | Duplicação parcial com PendingConfirmations (mostra pagamentos posted, não pendentes) — mantida sem alteração | Média | Mantida; foco diferente (cruzar vendas vs recebido) |
| FinanceDashboard | Cards leves já presentes (recv/pay/overdue/pending/caixas) | Baixa | Mantido |
| PaymentsPage | Escreve direto em `cash_movements` (update reconciled_at) | Alta | **Reportado em F23-D2**: criar RPC `cash_movement_reconcile`/`_undo` |
| PaymentsTab (orders) | Escreve direto em `sale_payment_schedules` (insert/update/delete) | Alta | **Reportado em F23-D2**: criar RPC `sale_payment_schedule_upsert/delete` |
| BillForm | Usa RPCs adequadas (supplier_bill_create/update/cancel) | OK | Sem ação |
| CashSessionDetail | Não tocado nesta iteração | — | F23-D2 |
| CustomerCreditsPage | Não tocado nesta iteração | — | F23-D2 |
| RegisterSupplierPaymentDialog | Usa supplier_payment_register | OK | — |
| RegisterPaymentDialog | Usa register_customer_payment | OK | — |

## Zero-bypass restante (a tratar em D2)
- `src/core/orders/PaymentsTab.tsx` linhas 109, 110, 141, 149, 150, 173 — writes em `sale_payment_schedules`
- `src/modules/finance/pages/PaymentsPage.tsx` linhas 212, 222, 235 — updates em `cash_movements`

## F23-D2 (próximo)
- RPC para schedules + RPC para reconciliação de caixa
- recurring_expenses backend+UI
- Upload comprovativos / anexos
- Reconciliação bancária
- Gráficos financeiros
