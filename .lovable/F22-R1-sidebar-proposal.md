# F22-R1 — Proposta de Estrutura de Sidebar

Status: **proposta** — não implementada nesta fase. Apenas ajustes seguros pequenos no `AppShell.tsx` (agrupamento/ordem) podem ser feitos em R1; reorganização completa fica para R-Sidebar.

## Estrutura proposta por áreas

### 1. Comercial
- Vendas — existe (`/sales/orders`)
- Pricelists — existe (`/sales/pricelists`)
- Clientes / Parceiros — existe (`/partners`)
- Regras de entrega — existe (`/sales/delivery-rules`)

### 2. Produtos
- Produtos — existe (`/products`)
- Variantes — escondido (acessível dentro de Produto)
- BOM — existe (`/products/bom`)
- Categorias — existe (`/products/categories`)
- Atributos — existe (`/products/attributes`)
- Colis / Packages — escondido (em breve como página dedicada)

### 3. Compras
- Necessidades — existe (`/purchase/needs`)
- Pedidos de compra — existe (`/purchase/orders`)
- RFQ Kanban — existe (`/purchase/rfq`)
- Fornecedores — re-usa `/partners` filtrado (em breve view dedicada)
- Contas a pagar — existe (`/finance/payables`)

### 4. Produção
- Ordens de fabrico — existe (`/manufacturing/orders`)
- Planning — existe (`/manufacturing/planning`)
- Dashboard — existe (`/manufacturing`)
- Chão de fábrica — existe (`/shopfloor`)
- Centros de trabalho — em breve
- Operações — em breve
- Máquinas — em breve

### 5. Inventário
- Stock — existe
- Localizações — existe
- Colis — em breve dedicado
- Danificados / Quarentena — em breve

### 6. Logística
- Rotas — existe (`/routes`)
- Entregas — existe (`/delivery`)
- Levantamentos — existe (`/m5/pickups`)
- Carrier shipments — existe (`/m5/carriers`)
- Veículos — em breve

### 7. Financeiro
- Pagamentos — existe (`/finance/payments`)
- Caixa — existe (`/cashbox`)
- Contas a receber — existe (`/finance/receivables`)
- Contas a pagar — existe (`/finance/payables`)
- Reconciliação — existe (`/finance/reconciliation`)
- Confirmações pendentes — existe (`/finance/pending`)
- Créditos cliente — **em breve** (F22-D)
- Bills fornecedor extras — **em breve** (F22-D)
- Cash reversals — **em breve** (F22-D)
- Driver handovers — existe (`/finance/driver-handovers`)

### 8. Assistência
- Casos — existe (`/service/requests`)
- Reparações — escondido (dentro de caso)
- RMA — em breve

### 9. Helpdesk
- Tickets — existe (`/helpdesk/tickets`)
- Portal Cliente — público (`/portal/:token`), sem entrada de sidebar (acesso externo)

### 10. Sistema
- Notificações — header global (NotificationsBell) + futura página "Minhas notificações"
- Tarefas — **por entidade** (RecordTasks) + futura página "Minhas tarefas"
- Conversas — **por entidade** (RecordConversations) + módulo Discuss global existente (`/discuss`)
- Configurações — existe (`/settings`)
- Health Checks — em breve
- Demo Flow — existe (`/demo-flow`)

## Onde vivem Notificações / Tarefas / Conversas

- **Notificações**: sino global no header (`NotificationsBell`, F21-B). Sem entrada própria na sidebar.
- **Tarefas**: componente `RecordTasks` embutido em cada página de detalhe (Sale Order, MO, Service Case, Ticket, Bill, etc.). Futuro: página "Minhas Tarefas" agregando por user.
- **Conversas**: componente `RecordConversations` embutido em cada detalhe; módulo `/discuss` continua como agregador global.

## Recomendações para R1 (mínimo seguro)

1. Não reorganizar a sidebar agora — risco alto para 0 valor imediato.
2. Garantir que cada módulo no `registry.ts` tem `area` (Comercial / Produção / etc.) — preparar terreno para R-Sidebar.
3. Quando R-Sidebar for executado: usar `SidebarGroup` por área conforme acima, com `defaultOpen` baseado na rota ativa.

## Próximo bloco recomendado após R1

**F22-R2 — OrderForm refactor operacional** (maior impacto operacional na entrada comercial). Sequência sugerida:

1. OrderForm (R2)
2. ManufacturingOrderDetail (R3)
3. PurchaseNeeds + PurchaseOrders (R4)
4. RouteDetail (R5)
5. ProductForm / BOM (R6)
6. Financeiro extras UI — Payments / Bills / Cash (R7 = F22-D)
