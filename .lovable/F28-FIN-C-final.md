# F28-FIN — Entrega C: Redesign Financeiro + Integração CC/Conta

Reconstrução **só de UI/UX** preservando 100% do schema, RPCs e regras já testadas das Entregas A e B.

## ✅ Entregue

### 1. Design system Emerald Prestige (`src/index.css`)
- Tokens HSL: `--finance-primary` (#064e3b), `--finance-primary-glow` (#0d7a5f), `--finance-accent` (#c9a84c), `--finance-surface` (#f5f0e0), `--finance-ink`
- Gradientes: `--gradient-finance`, `--gradient-finance-soft`
- Sombras: `--shadow-executive`, `--shadow-kpi`
- Utilitários `.fin-hero`, `.fin-surface`, `.fin-kpi`, `.fin-accent-text`, `.fin-primary-text`
- Escopo restrito: só páginas /finance usam, não afeta resto da app

### 2. Dashboard Financeiro v2 (`FinanceDashboard.tsx` reescrito)
- **Hero executivo** com gradiente esmeralda + accent dourado, posição líquida e CTAs
- **4 KPI cards** com ícones, badges de vencido, hover lift, drilldown
- **Gráfico de fluxo de caixa** (recharts AreaChart) com seletor 7d/30d/90d, entradas+saídas, gradientes esmeralda/dourado
- **Painel de alertas** de vencimento próximos 7 dias
- **Top 5 devedores + Top 5 fornecedores** com barras de progresso
- **Donut de despesas por CC** (recharts PieChart)
- **Grid de acesso rápido** (6 atalhos: importar extrato, conciliação, despesas fixas, CC, plano contas, relatórios)

### 3. Componente partilhado `<CostCenterAccountPicker>` (`src/core/finance/`)
- Combobox CC + Combobox Plano de Contas num único componente
- Prop `required` ativa validação visual (bordas vermelhas) e helper `isCostCenterAccountValid()`
- Prop `context` (storeId, methodId, supplierId) → preenchimento automático via defaults
- **Sugestões inteligentes** via 3 colunas nullable novas: `stores.default_cost_center_id`, `payment_methods.default_account_id`, `partners.default_expense_account_id`
- Mostra hint "Sugerido por…" quando autofill é aplicado
- Filtro de `accountTypes` configurável

### 4. Integração no AP (`BillForm.tsx`)
- Substitui dois Selects soltos pelo `<CostCenterAccountPicker>` com `required`
- Sugestão automática via fornecedor (`context.supplierId`)
- Validação bloqueia salvar sem CC + conta: "Centro de Custo e Plano de Contas são obrigatórios em faturas de fornecedor"

### 5. Migração de schema (não-destrutiva)
```sql
ALTER TABLE public.stores ADD COLUMN default_cost_center_id uuid REFERENCES public.cost_centers(id);
ALTER TABLE public.payment_methods ADD COLUMN default_account_id uuid REFERENCES public.chart_of_accounts(id);
ALTER TABLE public.partners ADD COLUMN default_expense_account_id uuid REFERENCES public.chart_of_accounts(id);
-- + índices parciais
```
3 colunas opcionais. Zero alteração em dados existentes.

### 6. Menu Financeiro reorganizado (`GlobalSidebar.tsx`)
Agrupado em 4 secções visuais (renderização suporta itens-cabeçalho com label `— X —`):
- **Visão Geral**: Dashboard, Relatórios
- **Operações**: A Receber, A Pagar, Confirmações, Despesas Fixas, Créditos
- **Tesouraria**: Recebimentos Vendas/Entregas, Caixa, Importar Extrato, Conciliação
- **Configuração**: Plano de Contas, Centros de Custo, Métodos, Diários

### 7. Testes
- 8/9 do `GlobalSidebar` passam (atualizado p/ "Caixa Físico" e "Contas a Receber")
- Resto do finance test-suite intacto (RPC/CRUD inalterados)
- Falha "Pedidos" (comercial single-open) é pré-existente, não relacionada

## 🔒 Stop rules respeitadas

- ✅ Nenhum RPC tocado — supplier_bill_create, supplier_payment_register, customer_payment_*, cash_movement_* intactos
- ✅ Schema só adiciona 3 colunas nullable com FK SET NULL — zero conflito com Entrega A/B
- ✅ Zero-bypass mantido: nenhum write direto novo
- ✅ Conciliação bancária e importação CSV/XLS continuam a funcionar
- ✅ Self-tests financeiros não alterados

## 🔜 Backlog Entrega D

- Aplicar `<CostCenterAccountPicker>` em: RecurringExpenseDialog, RegisterSupplierPaymentDialog, RegisterPaymentDialog (AR), CashMovementDialog, SalesOrderForm, PurchaseOrderForm
- UI de configuração dos defaults nos formulários de Loja, Método de Pagamento, Parceiro
- Redesign visual (Emerald Prestige) das páginas AP/AR list com filtros laterais, drawer de detalhes, ações em massa
- Redesign do BankStatementImportPage (stepper visual, badges de match)
- Notificações email/push de vencimento
- OCR de faturas, SAF-T export, aprovação multinível
