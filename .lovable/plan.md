# Manufatura + Chão de Fábrica

Vou reutilizar o que já existe (`products`, `boms`, `bom_lines`, `bom_operations`, `sale_orders`, `sale_order_lines`, `stock_quants`, `stock_moves`, `stock_pickings`, `stock_locations`, `user_roles`, `profiles`) e acrescentar apenas o que falta. Nada será apagado e nada será duplicado.

## Reuso de tabelas existentes
- **BOM**: `boms` + `bom_lines` + `bom_operations` já existem — uso direto, com a tela atual `/products/bom` mantida.
- **Produtos**: campo `can_be_manufactured` já existe — é o gatilho de fabricação.
- **Vendas**: `sale_orders` e `sale_order_lines` ficam intactos. Adiciono uma coluna `manufacturing_status` em `sale_order_lines` (computada a partir das ordens vinculadas).
- **Inventário**: reservas e movimentos passam por `stock_moves` / `stock_quants`, com locais virtuais (Production / Stock) já no padrão Odoo.

## Tabelas novas

```text
manufacturing_orders
  ├─ sale_order_id, sale_order_line_id, partner_id (cliente)
  ├─ product_id, variant_id, bom_id, qty, uom_id
  ├─ priority (0-3), state, planned_start, planned_end
  ├─ responsible_id, notes, location_src_id, location_dest_id
  └─ blocked_reason, code (MO/AAAA/####)

mo_components            -- snapshot da BOM no momento da MO
  ├─ mo_id, product_id, qty_required, qty_reserved, qty_consumed
  ├─ uom_id, scrap_pct, stock_move_id
  └─ status (pending|reserved|partial|consumed|missing)

mo_operations            -- etapas (corte, montagem, estofamento…)
  ├─ mo_id, sequence, name, workcenter
  ├─ planned_minutes, state (ready|in_progress|paused|done|qc|blocked)
  └─ started_at, finished_at, operator_id

mo_workorder_logs        -- apontamento por etapa
  ├─ mo_operation_id, operator_id, started_at, finished_at
  ├─ qty_done, qty_scrap, notes, attachments (jsonb)

mo_issues                -- problemas de produção
  ├─ mo_id, mo_operation_id, kind, description
  ├─ reported_by, reported_at, resolved_at, resolved_by

mo_quality_checks        -- controle de qualidade
  ├─ mo_id, mo_operation_id, result (pass|fail|rework)
  ├─ checked_by, checked_at, defects, notes, needs_rework
```

Tipos enum: `mo_state` (`draft|waiting_material|ready|in_progress|paused|qc|done|cancelled`), `mo_priority` (`low|normal|high|urgent`), `mo_issue_kind` (`material_missing|damaged|wrong_measure|defect|priority_blocked|other`).

## Automações (triggers + RPC SECURITY DEFINER)

1. **Confirmar venda** → trigger em `sale_orders` (state→confirmed) chama `mfg_create_orders_for_sale(_so_id)`:
   - para cada linha cujo produto tem `can_be_manufactured=true` e BOM ativa, cria MO com snapshot da BOM em `mo_components` e cria operações a partir de `bom_operations`;
   - tenta reservar stock dos componentes (cria `stock_moves` reservados); marca componentes faltantes;
   - estado inicial: `ready` se tudo reservado, `waiting_material` caso contrário.

2. **Iniciar etapa** (RPC `mfg_start_operation`) → operação `in_progress`, MO `in_progress`, atualiza `sale_order_lines.manufacturing_status='in_production'`.

3. **Concluir etapa** → RPC `mfg_finish_operation(qty_done, qty_scrap)`. Se for última etapa antes de QC, vai para estado `qc`.

4. **Concluir QC aprovado** (RPC `mfg_quality_pass`) → consome `mo_components` (stock_moves done, baixa `stock_quants`), cria entrada do produto acabado em `stock_quants` (Production→Stock), MO `done`, sale_order_line `ready_for_delivery`.

5. **QC reprovado** → cria nova `mo_operation` de retrabalho, MO volta a `in_progress`, marca `needs_rework=true` e registra issue.

6. **Reportar problema** (RPC `mfg_report_issue`) → cria `mo_issues`, MO `paused`/`waiting_material`, notifica gestor de produção via `notifications`.

7. **Recheque de stock** quando `stock_quants` mudar para componentes de MO em `waiting_material` → tenta reservar e promove para `ready`.

## RLS por papel

Reuso o sistema `user_roles` + função `has_role()` já existente. Acrescento roles novos quando necessário (ou mapeio para grupos existentes via `has_group`):

| Role | manufacturing_orders | mo_workorder_logs | mo_components | quality | issues |
|---|---|---|---|---|---|
| `system_admin` | RW | RW | RW | RW | RW |
| `production_manager` (novo) | RW | R | RW | RW | RW |
| `shop_floor_operator` (novo) | R (atribuídas) | RW (próprios) | R | C/R | C/R |
| Vendas existente | R (das suas vendas) | – | – | – | R |
| Inventário existente | R | – | R | – | – |

## Telas (todas com layout e tokens existentes)

- `/manufacturing` — Dashboard (cards: abertas, atrasadas, bloqueadas, prontas, em produção, concluídas semana, materiais em falta, gráfico de carga semanal).
- `/manufacturing/orders` — Lista filtrável (status, prioridade, cliente, produto, prazo). Botão "Nova MO".
- `/manufacturing/orders/:id` — Detalhe com abas: Geral, Componentes (com semáforo de stock), Operações, Apontamentos, Qualidade, Problemas, Venda relacionada.
- `/manufacturing/planning` — Lista por dia/semana (carga vs. capacidade) e fila por prioridade.
- `/manufacturing/bom` — redireciona para `/products/bom` existente (não duplico).
- `/shop-floor` — Kanban operacional grande (colunas mapeadas a partir de operações + estados).
- `/shop-floor/order/:id` — Cartão de execução: dados essenciais, botões grandes Iniciar/Concluir/Pausar/Problema, campos qty produzida/defeito.
- `/shop-floor/quality` — fila de QC com aprovar/reprovar/retrabalho.

Componentes reutilizáveis novos: `MOStateBadge`, `MOPriorityBadge`, `ComponentStockChip`, `BigActionButton`, `MOTimer`.

## Integração com Vendas (sem quebrar)
- Em `SalesPages` (form do pedido), nova aba/painel "Produção" que lista MOs vinculadas, status, previsão e bloqueios — somente leitura para vendas.
- `sale_order_lines.manufacturing_status` (enum `none|pending|waiting_material|in_production|qc|ready_for_delivery|cancelled`) atualizado por triggers.

## Integração com Inventário
- Reservas e consumos via `stock_moves` (não toco em quants diretamente fora dos triggers).
- Locais virtuais `Production` criados se não existirem, vinculados ao armazém padrão.
- Painel "Necessidades de materiais" em `/manufacturing` linka para `/inventory/reordering`.

## Registry & navegação
- Adiciono dois módulos em `src/core/modules/registry.ts`:
  - `manufacturing` (ícone `Factory`, cor azul-aço), menu: Dashboard, Ordens, Planejamento, BOM (link p/ produtos).
  - `shop_floor` (ícone `HardHat`, cor laranja), menu: Painel, Qualidade.
- Permissões adicionadas em `usePermissions` e checadas em `RequireAuth`.

## Entrega em 3 PRs (migrações separadas)

**PR 1 — Fundação backend** *(esta primeira iteração)*
- Migration: enums, 6 tabelas novas, índices, RLS, função `has_role` reaproveitada, triggers de criação de MO ao confirmar venda, RPC start/finish/issue/quality, locais virtuais, coluna `manufacturing_status` em `sale_order_lines`.
- Registry + rotas + páginas placeholder funcionais (lista de MOs e Kanban já lendo dados reais).

**PR 2 — Telas de Manufatura completas**
- Dashboard, detalhe da MO com todas as abas, planejamento, painel de venda integrado.

**PR 3 — Chão de Fábrica completo + QC + retrabalho**
- Kanban com drag, cartão de execução, apontamento com fotos, fila de QC, fluxo de retrabalho, notificações.

## Critérios de aceitação do fluxo completo

```text
Venda confirmada
 → trigger cria MO + snapshot BOM + reservas
 → MO ready ou waiting_material
 → operador inicia etapas no /shop-floor
 → QC aprova
 → consumo + entrada de PA no stock
 → sale_order_line = ready_for_delivery
```

Confirma para eu começar pelo **PR 1** (migration + registry + páginas base)? Se quiser ajustar nomes de roles, colunas ou divisão dos PRs, é só dizer antes de eu rodar a migração.
