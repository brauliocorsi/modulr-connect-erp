# F29 — Fase 4 (Bloco 7) — Compras

## Auditoria pré-existente

- `PurchaseNeedsList.tsx` já agrupa por fornecedor sugerido e chama `purchase_needs_create_po`. Cobre 7.2.
- `ReceiptsPage` (em `inventory/pages`) cobre receções; existem RPCs `purchase_order_receipt_status` mas não há um wizard dedicado de receção parcial com classificação Bom/Danificado/Em falta — ficou marcado como melhoria futura (precisa de nova RPC para criar `service_case` `supplier_defect` automaticamente; sem ela, fica manual). Não implementado nesta fase para não criar lógica de backend sem RPC garantida.

## Bloco 7.1 — Dashboard de Compras ✅ NOVO

**Rota:** `/purchase` (substitui o Navigate para `/purchase/orders`).

Página `PurchaseDashboardPage.tsx`:
- 4 KPIs no topo (Necessidades pendentes / Encomendas em curso / Receções 7d / Contas a pagar) com cores semânticas (rosa se vencidas).
- 4 tabelas (top 20 cada, polling 60s):
  - Necessidades pendentes com fornecedor sugerido + link para venda de origem.
  - Encomendas em curso (`draft`, `rfq_sent`, `confirmed`) ordenadas por `expected_date`.
  - Receções esperadas (`stock_pickings` `kind=incoming`, próximos 7 dias).
  - Contas a pagar (`supplier_bills` não pagas), highlight vermelho se vencidas.

Sidebar grupo "Compras" → adicionado "Dashboard" no topo.

## Próximas fases

- **Fase 5 (Bloco 8):** Calendário de vencimentos.
- **Fase 6 (Bloco 9):** Conciliação bancária com correspondência automática.
- **Fase 7 (Bloco 10):** Pipeline de estados em vendas + notificações realtime globais.
- **Backlog:** Wizard de receção parcial com defeitos (Bloco 7.3) — requer RPC dedicada.
