# Redesign do módulo Financeiro — estilo "Fecho do Dia"

Aplicar a mesma linguagem visual (branco, azul #2563EB, bordas finas, cantos 8px, badges semânticas verde/âmbar/vermelho/azul, KPIs com ícone, skeletons, painéis com header de ícone+título) a todas as páginas financeiras.

## 1. Criar primitivos partilhados (`src/modules/finance/ui/`)

Extrair os blocos visuais do `DailyClosePage` para um único módulo reutilizável:

- `FinancePageHeader` — título grande + subtítulo + data PT + botão refresh + slot de ações
- `KpiCard` — label, valor 36px, sub com tom (red/green/muted), ícone em pílula azul clara
- `Panel` — card com header (ícone azul + título) e zona de conteúdo / tabela
- `StateBadge` — tons `green | amber | red | blue | gray` (mesmos hex do Fecho do Dia)
- `TableSkeleton` / `EmptyState`
- `fmtEUR`, `fmtDate`, `fmtDateLong`, `hoursAgo` (helpers já no DailyClose movidos para `lib/format.ts` local)

`DailyClosePage` passa a importar destes primitivos (sem regressão visual).

## 2. Páginas a refazer (mesma estrutura, mesmo estilo)

Para cada página: cabeçalho `FinancePageHeader`, KPIs no topo quando aplicável, conteúdo dentro de `Panel`, tabelas com `border-border/60` + hover subtil, badges via `StateBadge`, vazios com `EmptyState`, loading com `TableSkeleton`, botões primários `bg-[#2563EB]`.

1. `FinanceDashboard` — hub do módulo, grelha de KPIs + atalhos para subpáginas
2. `PayablesList` — KPIs (vencidas, a vencer 7d, total dívida) + tabela contas a pagar
3. `ReceivablesPage` — KPIs (em atraso, a receber 30d, total) + tabela
4. `PaymentsPage` — tabela pagamentos com filtros, badges de método
5. `ReconciliationPage` — duas colunas (vendas / recebimentos) com painéis
6. `BankStatementImportPage` — wizard import + tabela linhas; manter parser intacto
7. `RecurringExpensesPage` — tabela + dialog
8. `ExpensesCalendarPage` — calendário mensal já criado, repintar com novos tons
9. `CustomerCreditsPage` — KPI total créditos + tabela
10. `CostCentersPage` — tabela simples
11. `DriverHandoversPage` — KPIs + tabela
12. `PendingConfirmationsPage` — tabela de aprovações
13. `FinanceReportsPage` — grelha de cards-link para relatórios
14. `BillForm` — formulário em painéis (card branco + bordas finas)
15. `FinancePages` (router interno, se existir) — só verificação

## 3. Sidebar

Os labels do grupo Financeiro já existem; apenas garantir consistência (sem alterações de rotas).

## 4. Não mexer

- Lógica de negócio, queries, RPCs, RLS
- Dialogs partilhados (`RegisterSupplierPaymentDialog`, `RegisterPaymentDialog`, `RecurringExpenseDialog`) — só uma passagem leve para usar `bg-[#2563EB]` no botão primário
- Estrutura de rotas em `App.tsx`

## Detalhes técnicos

- Tokens: o sistema usa HSL semantic tokens; aqui mantemos a exceção já aprovada (hex específicos da referência) confinada aos primitivos `StateBadge` e botão primário azul.
- Skeletons via `@/components/ui/skeleton`, sem bloquear a página.
- Refetch 60s nas páginas com KPIs ao vivo (Payables, Receivables, Dashboard).
- Sem migrações, sem alterações de tipos.

## Quality bar

- Cada página renderiza sem mexer em dados; layout responsivo a partir de 1024px com grelha 2 col, single col abaixo.
- Vazios e loading visíveis em todas as tabelas.
- Tipografia consistente (h1 24px semibold, h3 painel 14px semibold, label KPI 12px uppercase muted).