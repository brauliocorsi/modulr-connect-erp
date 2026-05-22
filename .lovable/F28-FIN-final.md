# F28-FIN — Relatório final (Entrega A)

## Implementado nesta entrega

### Base de dados (migração aplicada)
- **`chart_of_accounts`** (plano de contas) com tipos asset/liability/equity/revenue/expense, hierarquia (parent_id), RLS para autenticados.
- Coluna `account_id` adicionada em: `supplier_bills`, `supplier_payments`, `customer_payments`, `recurring_expenses`, `cash_movements`.
- `recurring_expenses` ganhou `cost_center_id` + `journal_id` (já tinha `payment_method_id`).
- **`bank_statement_imports`** + **`bank_statement_lines`** (lotes e linhas de extrato bancário, com dedup por hash).
- RPCs: `account_upsert`, `account_archive`, `bank_statement_import_create`, `bank_statement_line_insert`, `bank_reconciliation_confirm_match`.

### Frontend
- **Menu Financeiro reorganizado** (`GlobalSidebar.tsx`) — 17 itens cobrindo Visão Geral, A Receber, A Pagar, Banco/Caixa, Configuração; rotas antigas mantidas, novas adicionadas.
- **Plano de Contas** (`/finance/chart-of-accounts`) — listagem + formulário CRUD usando padrão `ListView`/`SimpleForm`.
- **Relatórios Financeiros** (`/finance/reports`) — landing com 8 relatórios funcionais com export CSV (UTF-8, separador `;`): AP por fornecedor, AR por cliente, recebimentos por método, pagamentos por conta, despesas por CC, despesas por plano de contas, pendências de conciliação, vencidos (AP+AR).
- **Importação de Extrato Bancário** (`/finance/bank-import`) — wizard 3 passos:
  1. Upload CSV/XLS/XLSX (parsed via SheetJS) com escolha de diário.
  2. Mapeamento de colunas (auto-detecção por nome) com prévia.
  3. Auto-match contra `customer_payments` por valor + data ± 3 dias, confirmação one-click idempotente via RPC.
- Dependência nova: `xlsx@0.18.5` (SheetJS).

### Auditoria
- `.lovable/F28-FIN-audit.md` — matriz completa de áreas, gaps e ações.

## O que fica para Entrega B (planeado)

- Contas a Pagar v2: colunas origem/CC/conta + filtros + escolha conta_id/CC no `RegisterSupplierPaymentDialog` (atualizar RPC `supplier_payment_register`).
- Contas a Receber v2: tabs (vendas/entregas/pendentes/vencidos/pagos), filtros origem/método/confirmado/vendedor/loja.
- Despesas Fixas v2: campos extra na UI (CC, conta, journal) + ação "gerar conta a pagar".
- Bank import: matching também para `supplier_payments`, importações guardadas para reprocessamento, melhor heurística por referência fuzzy.

## O que fica para Entrega C (planeado)

- Notificações de vencimento (cards no dashboard, sem email/SMS).
- Dashboard financeiro v2: segmentado vendas/entregas/banco/caixa/fornecedores + fluxo 7/30d.
- Diários: campos extra (IBAN, saldo inicial, conta contábil vinculada).
- Testes vitest para filtros + auto-match + RPCs novos.
- Zero-bypass sweep final.

## Zero-bypass (status parcial)

Os writes diretos conhecidos (`PaymentsTab.tsx` em `sale_payment_schedules`, `PaymentsPage.tsx` em `cash_movements`) já estavam reportados em F23-D1 e não foram tocados nesta entrega para não conflitar com F24-B. Serão eliminados na Entrega B com os RPCs correspondentes.

## Stop rules

Nenhuma das condições de paragem foi acionada: importação bancária protegida por hash único + RPC idempotente; não houve conflito com F24-B; nenhum self-test financeiro existente alterado.
