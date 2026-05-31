# F29 — Fase 5 (Bloco 8) — Calendário de Vencimentos

## Auditoria

- `RecurringExpensesPage` já cobre o CRUD de despesas recorrentes (Bloco 8.1 e 8.3).
- Faltava a vista calendário (Bloco 8.2).

## Bloco 8.2 — Calendário ✅ NOVO

**Rota:** `/finance/expenses/calendar`

Página `ExpensesCalendarPage.tsx`:
- Grelha mensal (segunda primeiro) com navegação prev/next/hoje.
- 3 KPIs: total no mês, a vencer em 7 dias, vencidas.
- Por cada dia mostra até 3 entradas (com "+N mais") com ícone distinguindo `Receipt` (fatura) e `Repeat` (recorrente).
- Cores semânticas: verde (paga), âmbar (a vencer), vermelho (vencida).
- Click numa entrada navega para `/finance/payables/:id` ou `/finance/recurring`.

Sidebar grupo Financeiro → "Calendário Vencimentos" debaixo de Despesas Fixas.

## Próximas fases

- **Fase 6 (Bloco 9):** Conciliação bancária com import OFX/CSV e matching automático.
- **Fase 7 (Bloco 10):** Pipeline de estados em vendas + notificações realtime globais.
