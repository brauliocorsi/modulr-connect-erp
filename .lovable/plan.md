# F28-FIN — Financeiro 3.0 Integrado

Plano para executar as 13 fases do reforço financeiro. Por escopo (≈30+ ficheiros novos/editados, várias migrations, RPCs e UIs), proponho dividir em **3 entregas sequenciais**, cada uma encerrada com testes + zero-bypass. Confirma a abordagem antes de eu começar a fase 1.

## Entrega A — Fundações (Fases 1, 2, 6, 7, 8)

Sem mexer em fluxos de pagamento ainda. Foco em estrutura.

1. **Auditoria** (F1) — gravar matriz em `.lovable/F28-FIN-audit.md` com áreas, gaps e ações por tabela/UI listadas.
2. **Reorganizar menu Financeiro** (F2) — `GlobalSidebar` + `FinancePages` com as 13 secções; rotas antigas mantidas como alias.
3. **Contas bancárias / diários** (F6) — usar tabela existente (`payment_methods`/`financial_accounts` — confirmar na auditoria); UI de listagem/edição com saldo inicial, IBAN, conta contábil.
4. **Centros de custo** (F7) — migration `cost_centers` (se não existir) + RPC `cost_center_upsert/archive` + página `/finance/cost-centers`. Adicionar coluna `cost_center_id` em `supplier_bills`, `supplier_payments`, `customer_payments`, `recurring_expenses`, `cash_movements` (nullable).
5. **Plano de contas** (F8) — migration `chart_of_accounts` + RPCs + página `/finance/chart-of-accounts`. Adicionar `account_id` nullable nas mesmas tabelas.

## Entrega B — Operação AP/AR + Despesas + Conciliação (Fases 3, 4, 5, 9)

6. **Contas a pagar v2** (F3) — colunas extras (origem, CC, conta), filtros, escolha de conta/CC nos dialogs `RegisterSupplierPaymentDialog`. RPC `supplier_payment_register` passa a aceitar `_cost_center_id`, `_account_id`, `_journal_id`.
7. **Contas a receber v2** (F4) — tabs/segmentação (vendas/entregas/pendentes/vencidos/pagos), filtros (origem, método, confirmado, vendedor, loja), colunas extras.
8. **Despesas fixas v2** (F9) — completar `recurring_expenses` (CC, conta, conta de pagamento), ação "gerar conta a pagar" → cria `supplier_bill` via RPC; histórico de bills geradas.
9. **Conciliação bancária com import** (F5):
   - migration `bank_statement_imports` + `bank_statement_lines` (raw)
   - RPCs: `bank_statement_import_batch_create`, `bank_statement_line_import`, `bank_reconciliation_auto_match`, `bank_reconciliation_confirm_match`
   - UI 3 passos: upload CSV/XLS/XLSX (usar `xlsx`/`papaparse`) → mapeamento de colunas → preview/confirm matches
   - Auto-match por valor + data ± janela + referência fuzzy + entidade
   - Confirm marca `customer_payment.reconciled_at` e `sale_payment_schedule` confirmado pelo financeiro; nunca cria `cash_movement`

## Entrega C — Visibilidade + Qualidade (Fases 10, 11, 12, 13 + zero-bypass)

10. **Notificações de vencimento** (F10) — hook + cards no dashboard + badges (sem email).
11. **Dashboard financeiro** (F11) — cards segmentados (vendas/entregas/banco/caixa/fornecedores) + fluxo previsto 7/30d.
12. **Relatórios** (F12) — `/finance/reports` com 8 relatórios, filtros, export CSV.
13. **Testes** (F13) — vitest para filtros AP/AR, mapeamento de extrato, auto-match, confirm, RPCs de CC/conta.
14. **Zero-bypass sweep** — `rg` nas tabelas listadas; corrigir qualquer write direto.
15. **Relatório final** em `.lovable/F28-FIN-final.md`.

## Detalhes técnicos chave

- **Migrations:** todas com RLS já existente preservada; novos campos `cost_center_id`/`account_id` nullable para não quebrar registos.
- **RPCs SECURITY DEFINER** com `set search_path = public`; assinaturas seguem padrão `_xxx` dos RPCs financeiros já criados (F23-D2).
- **Sem dependências novas pesadas:** XLSX já vem via `xlsx`/`exceljs` se presente; caso contrário adiciono `xlsx` (SheetJS) — única dep nova.
- **Compatibilidade:** rotas antigas (`/finance/payables`, `/finance/receivables`, `/finance/recurring`, etc.) mantidas como alias para os novos paths.
- **Stop rules respeitados:** se a auditoria F1 detectar conflito com F24-B (finance core) ou ambiguidade contábil (ex.: como contabilizar match parcial), eu paro e pergunto antes de avançar.

## Risco principal

A importação bancária (F5) é o passo de maior risco de duplicação. Mitigação: dedup por `(import_batch_id, line_hash)` único + RPC `bank_reconciliation_confirm_match` idempotente (rejeita se `customer_payment.reconciled_at` já preenchido).

## Pergunta antes de começar

Confirmas as 3 entregas sequenciais? Ou queres apenas a Entrega A primeiro e revemos antes de B/C?
