# Integração Produtos · Inventário · Compras ↔ Vendas · Manufatura · Chão de Fábrica

Objetivo: adaptar (não recriar) os módulos existentes para um fluxo Odoo-like, totalmente integrado, sem quebrar funcionalidades atuais.

## Princípios

- Reaproveitar tabelas existentes (`products`, `stock_moves`, `stock_pickings`, `stock_locations`, `manufacturing_orders`, `mo_*`, `boms`, `purchase_orders`, `product_suppliers`, `reordering_rules`, `sale_orders`, `sale_order_lines`, `partners`, `notifications`, `user_groups`, `group_permissions`).
- Adicionar somente colunas/tabelas/funções **faltantes**.
- Toda mutação de stock continua via `stock_moves` / `stock_pickings` (nunca update direto).
- Notificações via função `notify_user` já em uso.
- RLS: manter políticas atuais; novas tabelas com policies equivalentes.

---

## PR1 — Produtos (tipologia + flags + dashboard)

**Schema (migração):**
- `products`: adicionar (se não existirem)
  - `product_kind` enum: `finished | raw | component | service | manufactured | purchased | mixed` (default deduzido de `can_be_sold/can_be_purchased/can_be_manufactured`)
  - `can_be_manufactured boolean default false`
  - `requires_bom boolean default false`
  - `mfg_lead_time_days int default 0`
  - (já existem: `can_be_sold`, `can_be_purchased`, `track_inventory`, `purchase_lead_time_days`, `min_stock`, `max_stock`, `cost`, `list_price`, `uom_id`, `category_id`)
- Backfill `product_kind` a partir das flags atuais.

**Frontend:**
- `ProductForm.tsx`: novas seções "Tipo & Capacidades" e "Lead times". Toggle `requires_bom` aparece se `can_be_manufactured`.
- `ProductsList.tsx`: filtros por `product_kind`, badges de capacidade.
- Novo `ProductsHealthDashboard` (rota `/products` mantém atual; adicionar aba/cartões): produtos sem fornecedor, sem custo, sem stock mínimo, fabricáveis sem BOM, compráveis sem `product_suppliers`.

---

## PR2 — Inventário (stock virtual, reservas, dashboard)

**Schema:**
- View `v_product_stock` por produto (e opcional por warehouse):
  - `qty_on_hand` (sum de quants reais)
  - `qty_reserved` (sum de `stock_moves` em `reserved/assigned` outgoing/internal para produção/venda)
  - `qty_incoming` (moves incoming não done + linhas de PO confirmadas não recebidas)
  - `qty_in_production` (MO state in `confirmed/planned/in_progress` qty_to_produce)
  - `qty_available = on_hand - reserved`
  - `qty_forecast = on_hand - reserved + incoming + in_production`
- Trigger em `stock_moves` para refrescar agregados (ou view materializada com refresh on demand).

**Frontend:**
- `StockTab.tsx` (produto): mostrar 6 KPIs (físico, reservado, disponível, em compra, em produção, previsto) + min/max.
- `InventoryDashboard`: adicionar cards "Stock baixo", "Stock previsto negativo", "Reservados", "Top consumo (30d)".
- Página `LowStockPage` reutilizando `reordering_rules` + `v_product_stock`.
- Ajustes manuais já existentes: garantir campo `reason` obrigatório + log do user (já há `created_by`).

---

## PR3 — Compras (necessidades, fluxo, recebimento)

**Schema:**
- Nova tabela `purchase_needs`:
  - `id, product_id, qty_needed numeric, origin_kind enum('sale','manufacturing','min_stock','manual','forecast'), sale_order_id, manufacturing_order_id, suggested_partner_id, priority int, needed_by date, state enum('pending','quoting','approved','po_created','partially_received','received','cancelled'), purchase_order_id, notes, created_by, created_at, updated_at`
  - RLS: leitura para grupos `purchase_*`, `inventory_*`, `system_admin`; escrita para `purchase_manager`/`system_admin`.
- Funções:
  - `create_purchase_need(_product, _qty, _origin, _sale, _mo, _needed_by)` — usada por gatilhos.
  - `po_receive_line(...)` (se ainda não cobre): ao receber, atualiza `purchase_needs.state` e dispara `notify_user` para vendedor / gestor de produção das origens.
- Gatilhos:
  - `sale_orders` confirmada (já reserva): se `qty_available < qty`, cria `purchase_needs` (`origin='sale'`) **apenas** para produtos `can_be_purchased` sem fabricabilidade preferida.
  - `manufacturing_orders` materiais em falta (já existe lógica de reserva): emitir `purchase_needs` (`origin='manufacturing'`) para componentes faltantes.
  - `reordering-cron`: além de criar RFQs, também grava `purchase_needs` (`origin='min_stock'`).

**Frontend:**
- Novo `PurchaseNeedsList` (rota `/purchase/needs`): filtros por origem/estado/produto, ação "Converter em Pedido de Compra" (agrupando por fornecedor sugerido).
- `PurchaseDashboard`: cards Necessidades pendentes, Pedidos enviados, Compras atrasadas (`expected_date < today` + state != received), Recebidas esta semana, Materiais bloqueando produção, Materiais bloqueando venda (cruzando `purchase_needs` com origem).
- `PurchaseOrdersList`: coluna "Origem" (deriva de `purchase_needs.purchase_order_id`).
- Recebimento (já existe pickings incoming): hook pós-done que marca `purchase_needs` ligadas como `received`/`partially_received` e notifica vendedor + produção.

---

## PR4 — Integração Vendas (visibilidade + alertas)

**Frontend (sem mudança de regra de negócio existente):**
- `OrderForm.tsx` linhas: por linha, badge com `qty_available` do produto, ícone se "precisa comprar" (há `purchase_need` aberta) ou "precisa fabricar" (há MO ligada), tooltip com previsão (`min(needed_by da need, expected_date do PO, scheduled_finish da MO)`).
- Novo painel `SaleAvailabilityPanel` (debaixo do `SaleProductionPanel`): lista necessidades de compra abertas + POs ligadas + status.
- Notificações novas (via triggers existentes + novos):
  - venda gerou necessidade de compra
  - PO ligada confirmada / parcialmente recebida / recebida
  - MO ligada iniciada / concluída
  - bloqueio por falta de matéria crítica
  Todas usam `notify_user` para `sale_orders.salesperson_id` com `app_module='sales'` e link para a venda.

---

## PR5 — Chão de Fábrica (alertas, sem novas permissões de escrita)

- `ShopFloorOrder.tsx`: badge no topo "Materiais OK / Em falta / Compra pendente / Bloqueado", calculado a partir de reservas da MO + `purchase_needs` ligadas.
- Botão "Iniciar" desabilita se status `bloqueado` (operador vê motivo, não altera nada).

---

## PR6 — Permissões

- Adicionar (se faltar) entradas em `group_permissions` para:
  - `purchase:purchase_needs:view/create/edit`
  - `inventory:stock_moves:view` (já), reforçar restrição de edit a `inventory_manager`/`system_admin`.
  - `sales:sale_orders:view` para grupo `production` (read-only) — necessário para painel.
- Sem alterações em grupos existentes que já funcionem.

---

## Ordem de execução

1. PR1 migração + UI Produtos
2. PR2 view + UI Inventário
3. PR3 tabela `purchase_needs` + triggers + UI Compras
4. PR4 UI Vendas + notificações
5. PR5 alertas Chão de Fábrica
6. PR6 ajustes de permissões + smoke test do fluxo end-to-end (venda → need → PO → recebimento → MO desbloqueia → produção → PA → venda atualizada)

## Detalhes técnicos

- Toda nova migração inclui RLS + índices em `(product_id)`, `(state)`, `(suggested_partner_id)`, `(sale_order_id)`, `(manufacturing_order_id)`, `(needed_by)`.
- Reuso de `notify_user(user_id, title, body, app_module, link)` já presente no projeto.
- Sem novos buckets, sem novos enums duplicados, sem renomear colunas existentes.
- Tipos do Supabase regenerados automaticamente a cada migração — não editar `types.ts` manualmente.

Confirma que posso começar pelo **PR1 (Produtos)** e seguir em sequência até PR6?
