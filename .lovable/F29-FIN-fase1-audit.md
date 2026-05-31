# F29 — Fase 1 (Blocos 1+2+11) — Auditoria

## Bloco 11 — Migração SQL BNPL

**Status:** ❌ A executar.

`payment_methods` já tem `journal_type`, `settlement_delay_days`, `default_account_id`, mas **não tem** `provider_fee_pct` nem `provider_fee_fixed`. View `bnpl_pending_settlements` **não existe**.

Ação: aplicar migração exatamente como no prompt + seed Scalapay/Sequra via insert.

## Bloco 1 — Dashboard "Fecho do Dia" (`/finance/daily`)

**Status:** ❌ Página não existe.

Confirmado que todos os ingredientes existem no schema:

| Card / Secção | Fonte | Notas |
|---|---|---|
| 1.1 Caixas abertas | `cash_sessions` (state='open') + `cash_registers` para nome/loja | OK |
| 1.1 Entregas por reconciliar | `delivery_route_cash_closure` (reconciled_at IS NULL) | OK |
| 1.1 Contas a pagar hoje | `supplier_bills` (state ≠ 'paid', due_date ≤ today) | OK |
| 1.1 BNPL por liquidar | `customer_payments` JOIN `payment_methods` (journal_type='bnpl', reconciled_at IS NULL) | Usar view nova `bnpl_pending_settlements` |
| 1.2 Caixas abertas | `cash_sessions` + register.store_id/driver_id/warehouse_id | Tipo inferido por colunas |
| 1.3 Entregas por reconciliar | `delivery_route_cash_closure` + `delivery_routes` + driver | Variância já é coluna gerada |
| 1.4 Contas a pagar | `supplier_bills` + `partners` | Modal de pagamento reutiliza `RegisterSupplierPaymentDialog` existente |
| 1.5 BNPL pendente | view `bnpl_pending_settlements` | Ordenar por `expected_settlement_date` |

Componentes reutilizáveis: `FinanceHero`, `FinanceDashboard` (KPI pattern já estabelecido), `RegisterSupplierPaymentDialog`.

Adicionar entrada no sidebar grupo "Visão Geral" como "Fecho do Dia".

## Bloco 2 — Fecho de Caixa do Entregador (`/delivery/routes/:routeId/cash-close`)

**Status:** ❌ Página dedicada não existe. Há `DeliveryCashbox.tsx` e `DriverHandoversPage.tsx` mas não cobrem o fluxo de duas fases por rota.

Funções/tabelas disponíveis:
- `delivery_route_cash_close(_route_id uuid, _actuals jsonb, _notes text)` ✅
- `delivery_route_cash_closure` (expected_* já calculado, actual_* a preencher, variance gerada) ✅
- `delivery_route_orders` + `delivery_schedules` → entregas da rota ✅
- `customer_payments` por schedule → expected por método ✅

Plano:
- **Fase 1 (Resumo):** carregar rota + delivery_route_orders + payments esperados agrupados por método (cash/mbway/transfer/other → mapear via `payment_methods.journal_type` / code).
- **Fase 2 (Form):** 4 inputs numéricos, cálculo de variância em tempo real, notas obrigatórias se ≠ 0, submit chama `delivery_route_cash_close`.
- **Comprovante:** rota `/delivery/routes/:routeId/cash-close/receipt` em layout print-friendly.

Adicionar rota no `App.tsx` dentro do shell autenticado.

## Entregáveis Fase 1

1. Migração SQL (Bloco 11)
2. `src/modules/finance/pages/DailyClosePage.tsx` + rota `/finance/daily` + entrada sidebar
3. `src/modules/delivery/pages/RouteCashClosePage.tsx` + rota `/delivery/routes/:routeId/cash-close`
4. `src/modules/delivery/pages/RouteCashCloseReceipt.tsx` para impressão

Idioma: PT-PT. Estilo: Emerald Prestige (tokens já em `index.css`).
