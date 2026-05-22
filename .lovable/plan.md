
# F28-FIN — Entrega C: Redesign Financeiro + Integração CC/Conta

Reconstrução **só de UI/UX** preservando 100% do schema, RPCs e regras já testadas das Entregas A e B. Aplicação da paleta **Emerald Prestige** (verde profundo + dourado) e integração de Centros de Custo e Plano de Contas no resto do sistema (vendas, compras, caixa) com a regra **obrigatório em despesas/AP, sugerido com defaults nos demais**.

---

## 1. Design system Emerald Prestige

Adicionar tokens ao `src/index.css` e `tailwind.config.ts` (HSL):

- `--finance-primary` (verde esmeralda #064e3b) e `--finance-primary-glow` (#0d7a5f)
- `--finance-accent` (dourado #c9a84c)
- `--finance-surface` (creme #f5f0e0) para superfícies executivas
- Gradiente `--gradient-finance`, sombra `--shadow-executive`, badges de KPI

Tokens aplicados apenas em páginas `/finance/*` — não muda visual do resto da app.

## 2. Novo Dashboard Financeiro v2 (`FinanceDashboard.tsx`)

Layout em 3 zonas:

```text
┌─────────────────────────────────────────────────┐
│ KPI Cards (6): A Receber | A Pagar | Vencidos R │
│ Vencidos P | Caixa Hoje | Saldo Banco           │
├──────────────────────┬──────────────────────────┤
│ Fluxo Caixa 7/30/90d │ Top 5 Fornecedores       │
│ (gráfico área)       │ Top 5 Clientes devedores │
├──────────────────────┼──────────────────────────┤
│ Despesas por CC      │ Alertas vencimento (7d)  │
│ (donut)              │ + Confirmações pendentes │
└──────────────────────┴──────────────────────────┘
```

Usa recharts (já instalado). Drilldown clicando KPI → página relevante.

## 3. Redesign AP (PayablesList) e AR (ReceivablesPage)

Estrutura comum:
- **Sidebar de filtros** colapsável (fornecedor/cliente, CC, conta, método, loja, vendedor, período, estado)
- **Tabs no topo** mantendo lógica atual (Todos/Vencidos/Pagos/...)
- **Tabela densa** com colunas configuráveis, badges de origem e estado consistentes via `OperationalStatusBadge`
- **Barra de ações em massa** (selecionar várias contas → registar pagamento em lote, exportar CSV)
- **Drawer lateral** ao clicar uma linha (em vez de modal) com tabs Detalhes / Pagamentos / Documentos / Atividade

Sem alterar nenhum RPC nem regra de negócio.

## 4. Redesign Banco/Caixa + Conciliação

- `BankStatementImportPage`: wizard com stepper visual, prévia de match com badges coloridos (verde=auto, dourado=parcial, cinza=manual), barra de progresso
- `ReconciliationPage`: split view venda × recebimento lado a lado com drag-para-conciliar
- `CashboxPage`: hero com saldo + entradas/saídas do dia, gráfico mini

## 5. Integração CC + Plano de Contas no resto do sistema

Criar componente partilhado `<CostCenterAccountPicker>` em `src/core/finance/` com:
- Combobox CC (carrega de `cost_centers`)
- Combobox Conta (carrega de `chart_of_accounts`)
- Prop `required` (true para despesas/AP, false para o resto)
- Sugestão automática via prop `defaults` (loja, método, fornecedor)

**Pontos de integração** (apenas adicionar picker ao formulário, gravação já suportada pelos RPCs):

| Página | Picker | Obrigatório? |
|---|---|---|
| `BillForm` (AP) | CC + Conta | ✅ Sim |
| `RecurringExpenseDialog` | CC + Conta | ✅ Sim |
| `RegisterSupplierPaymentDialog` | CC + Conta | ✅ Sim |
| `RegisterPaymentDialog` (AR) | CC + Conta | Sugerido |
| `CashMovementDialog` | CC + Conta | Sugerido |
| `SalesOrderForm` (campo opcional CC) | CC | Sugerido (herda da loja) |
| `PurchaseOrderForm` | CC + Conta | Sugerido |

**Defaults inteligentes**: hook `useFinanceDefaults({storeId, methodId, supplierId})` que devolve CC/conta sugeridos a partir de:
- loja → CC mapeado (config nova em `stores.default_cost_center_id` — migração pequena)
- método de pagamento → conta sugerida (`payment_methods.default_account_id`)
- fornecedor → conta de despesa preferida (`partners.default_expense_account_id`)

## 6. Reorganização do menu Financeiro

Agrupar os 17 itens atuais em 4 secções colapsáveis no `GlobalSidebar`:

```text
Financeiro
├── 📊 Visão Geral (Dashboard, Relatórios)
├── 💰 Operações (A Receber, A Pagar, Pendentes, Despesas Fixas)
├── 🏦 Tesouraria (Banco, Caixa, Importar Extrato, Conciliação)
└── ⚙️ Configuração (Plano de Contas, Centros de Custo, Métodos, Diários)
```

## 7. Testes e zero-bypass

- Atualizar testes existentes para nova UI (mantendo asserts de lógica)
- Novo teste para `CostCenterAccountPicker` e `useFinanceDefaults`
- Zero-bypass sweep mantido — nenhum write direto novo
- Self-tests financeiros existentes não são tocados

## Detalhes técnicos

- **Schema** (migração pequena, não destrutiva):
  - `stores.default_cost_center_id` (nullable, FK cost_centers)
  - `payment_methods.default_account_id` (nullable, FK chart_of_accounts)
  - `partners.default_expense_account_id` (nullable, FK chart_of_accounts)
- **Sem alterações** em: supplier_bills, customer_payments, supplier_payments, cash_movements, recurring_expenses, RPCs existentes
- **Stack**: shadcn + tailwind tokens, recharts para gráficos, framer-motion já presente para transições do dashboard
- **Rotas**: mantém todas; sem breaking changes

## Backlog deixado para Entrega D

- Notificações push/email de vencimento
- OCR de faturas de fornecedor
- SAF-T export
- Aprovação multinível de AP
- IA/MCP financeiro

## Stop rules respeitadas

- Nenhuma duplicação de pagamento/fatura possível (RPCs intocados)
- Self-tests financeiros não alterados
- Schema só adiciona 3 colunas nullable (zero conflito)
- Zero-bypass preservado
