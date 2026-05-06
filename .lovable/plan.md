
# UP Móveis ERP — Release 1: Fundação + Vendas, Compras e Stock (WMS)

Construir a base de um ERP modular inspirado no Odoo, já entregando o ciclo completo Cotação → Venda → Reserva de stock → Compra automática → Recebimento → Picking/Packing → Entrega. Tudo desenhado para que módulos futuros (Manufatura/MRP, Entregas, Chat tipo RAMBU, Contabilidade, etc.) se conectem sem refatorar.

---

## 1. Princípios de arquitetura modular

- **Registro de módulos**: cada módulo (sales, purchase, inventory, products, hr, etc.) se auto-registra com: rotas, itens de menu, permissões, widgets de dashboard, hooks de notificação e "ganchos de integração" (ex.: `onSaleConfirmed`, `onStockBelowMin`).
- **Bus de eventos interno** (event bus em runtime + tabela `module_events` no banco): módulos publicam eventos; outros assinam **só se instalados/ativos**. Se Compras não estiver ativo, o evento `stock.below_min` simplesmente não dispara reabastecimento.
- **Tabela `installed_modules`**: liga/desliga módulos por tenant. UI de "Apps" no estilo Odoo.
- **Camada de UI compartilhada**: layout Odoo-like (top bar com app switcher, breadcrumb, busca global, chatter lateral, sino de notificações), list/kanban/form views reutilizáveis, filtros + agrupamento + favoritos salvos.

---

## 2. Fundação (núcleo do ERP)

### 2.1 Autenticação e usuários
- Lovable Cloud Auth: e-mail/senha + Google.
- Tabela `profiles` (nome, avatar, cargo, departamento, idioma, ativo).
- Tabela `companies` (multi-empresa preparada, 1 empresa default agora).

### 2.2 Permissões granulares (estilo Odoo)
- `permissions` (módulo, entidade, ação: view/create/edit/delete/export).
- `groups` (ex.: "Vendas / Usuário", "Vendas / Gerente", "Stock / WMS").
- `group_permissions` (group ↔ permission).
- `user_groups` (usuário ↔ grupos).
- `record_rules` (regras por registro: ex.: vendedor só vê seus pedidos; gerente vê todos do time).
- Hook `usePermission(module, entity, action)` no front + RLS no banco usando funções `security definer` (`has_permission`, `has_group`).
- Tela **Configurações → Usuários e Grupos**: matriz de permissões editável.

### 2.3 Layout & navegação Odoo-like
- **App switcher** (grid de apps instalados).
- **Top bar** com: módulo atual, breadcrumb, busca global, sino de notificações, menu do usuário.
- **Busca global** (Cmd/Ctrl+K) federada: pesquisa em produtos, clientes, fornecedores, pedidos, ordens de compra, transferências; respeita permissões.
- **Search bar por módulo** com filtros, agrupamentos e favoritos persistidos por usuário.
- Views reutilizáveis: List, Kanban, Form, Pivot (básico), Calendar (preparado).

### 2.4 Notificações unificadas
- `notifications` (user_id, módulo, tipo, payload, lido_em, link).
- Centralizadas no sino + toast em tempo real (Realtime).
- Cada módulo publica via helper `notify(users, module, type, payload)`.
- Preparado para o futuro chat (tabela `chat_threads`, `chat_messages`) — não construído agora, mas o schema de notificações já cobre menções.

### 2.5 Chatter por registro (estilo Odoo)
- Componente `<RecordChatter recordType recordId />` em todo formulário: log de auditoria + comentários + seguidores. Reaproveitável em vendas, compras, produto, transferência, etc.

### 2.6 Auditoria
- `audit_log` automático em criar/editar/excluir das entidades principais.

---

## 3. Módulo Produtos (compartilhado)

- **Templates de produto** + **variantes** geradas por **atributos** (ex.: cor, tamanho, acabamento). Combinações com SKU próprio, preço extra, código de barras, peso/volume.
- Tipos: estocável, consumível, serviço.
- Categorias hierárquicas, unidades de medida + conversões.
- Múltiplos fornecedores por produto com lead time e preço.
- **BOM multinível**:
  - Componentes com quantidade e UM.
  - Sub-montagens (BOM dentro de BOM) e BOM "fantasma" (phantom).
  - Operações/rotas (placeholder para o módulo de Manufatura futuro).
  - Cálculo de custo rolado a partir dos componentes.
- Aba "Inventário" (rotas: comprar, fabricar — fabricar fica desabilitado até Manufatura ser instalado), pontos de pedido (min/max).
- Aba "Vendas" (preço de venda, impostos, descrição comercial).
- Aba "Compras" (fornecedores, prazo).
- Imagens, anexos, chatter.

---

## 4. Módulo Stock / Inventário (WMS completo)

### 4.1 Estrutura física
- **Armazéns** múltiplos.
- **Locais** hierárquicos por armazém: Stock, Input, Quality, Output, Sucata, Cliente, Fornecedor, Trânsito.
- **Zonas** dentro de armazém e **posições/bins** (corredor-prateleira-nível).

### 4.2 Movimentos e operações
- **Tipos de operação**: Recebimento, Transferência interna, Picking, Packing, Expedição, Devolução, Ajuste.
- **Stock moves** (linha) e **Pickings/Transfers** (cabeçalho), com estados: rascunho → aguardando → pronto → feito → cancelado.
- **Reservas** automáticas de stock para pedidos de venda.
- **Lotes/Séries** com rastreabilidade ponta-a-ponta (relatório de rastreabilidade).
- **Ondas de picking** (wave picking) e **batch picking**.
- **Estratégias**:
  - Put-away: regra "produto/categoria → local de destino".
  - Removal: FIFO, LIFO, FEFO (vencimento), mais próximo.
- **Cycle counting** (contagem cíclica) e ajustes de inventário com aprovação.
- **Quants** (quantidade real por produto/lote/local) — fonte da verdade do stock.
- **Kardex/relatório de movimentações** por produto, lote, local, período.

### 4.3 Regras de reabastecimento
- Pontos de pedido (min/max) por produto/armazém.
- Job (edge function agendada) que avalia stock virtual (em mãos − reservado + em pedido) e:
  - Se módulo Compras instalado → cria RFQ/PO automática para fornecedor preferido.
  - Se módulo Manufatura instalado → cria ordem de produção (futuro).
  - Se nenhum → apenas notifica responsáveis.
- Suporte a **stock negativo** com alerta vermelho e gatilho imediato de compra.

### 4.4 Visões
- Dashboard de operações (cards por tipo de operação com pendências).
- Kanban de transferências por estado.
- Tela de "Atualizar quantidade" rápida em produto.

---

## 5. Módulo Vendas

- **Clientes** (compartilha tabela `partners` com Compras; flag is_customer/is_supplier).
- **Cotações → Pedidos de venda**: numeração, validade, condições, vendedor, equipe de vendas.
- Linhas com produto/variante, quantidade, desconto, imposto, preço.
- Tabelas de preço (pricelists) por cliente/categoria/quantidade.
- Confirmação de pedido:
  - Cria reserva no Stock (transferência de saída em rascunho).
  - Dispara evento `sale.confirmed` → Stock reserva; se faltar, evento `stock.shortage` → Compras gera RFQ.
- Estados: rascunho, enviada, pedido confirmado, entregue, faturado (placeholder), cancelado.
- Entrega parcial e backorders.
- Relatórios: vendas por vendedor, por cliente, por produto, funil de cotações.
- Kanban de cotações + pipeline.
- Chatter, anexos, envio por e-mail (preparado).

---

## 6. Módulo Compras

- **Fornecedores** (em `partners`).
- **RFQ (cotação) → Pedido de compra**: linhas, prazos, incoterms (campo), moeda (placeholder).
- Geração automática a partir de:
  - Reabastecimento (regras min/max).
  - Falta de stock para venda confirmada (make-to-order).
  - Stock negativo (gatilho imediato).
- Estados: rascunho, RFQ enviada, confirmada, recebida (parcial/total), cancelada.
- Recebimento gera transferência de entrada no Stock automaticamente.
- Comparativo de fornecedores por produto (preço, lead time, histórico).
- Relatórios: compras por fornecedor, por produto, prazo médio.

---

## 7. Integrações entre módulos (já neste release)

```text
Vendas ──confirma──► Stock (reserva saída)
                       │
                       └─ falta stock ──► Compras (RFQ automática)
Compras ──recebe────► Stock (entrada)
Stock ──min atingido──► Compras (reabastecimento)
Produtos ◄──── usado por ──── Vendas, Compras, Stock, (Manufatura futuro)
Permissões ──filtra──► toda UI + RLS
Notificações ◄── todos os módulos
Chatter ◄── todos os registros principais
```

Todas as integrações passam pelo bus de eventos e checam `installed_modules` antes de agir.

---

## 8. Entregáveis de UI deste release

- Tela de login + recuperação de senha.
- App switcher / home com apps instalados.
- **Apps**: ligar/desligar Vendas, Compras, Stock, Produtos.
- **Configurações**: Usuários, Grupos, Permissões, Empresas, Armazéns, Locais, Atributos, Categorias, UM, Tabelas de preço, Pontos de pedido.
- **Produtos**: lista + kanban + form com variantes e BOM multinível.
- **Vendas**: cotações (kanban + lista), clientes, pedidos, relatórios.
- **Compras**: RFQs, pedidos, fornecedores, relatórios.
- **Inventário**: dashboard de operações, transferências, ajustes, lotes/séries, kardex, regras de reabastecimento, configuração de armazéns/locais/bins.
- Busca global (Cmd+K), sino de notificações, chatter em todos os formulários, search bar com filtros/agrupamentos/favoritos em todos os módulos.

---

## 9. Detalhes técnicos

- **Stack**: React + Vite + Tailwind + shadcn (já no projeto), React Router, TanStack Query, Zustand para estado global leve (módulo ativo, app switcher), Lovable Cloud (Postgres + Auth + Realtime + Edge Functions + Storage).
- **Banco**: schema dividido logicamente por módulo (prefixos `sale_`, `purchase_`, `stock_`, `product_`, `core_`). RLS em todas as tabelas via funções `security definer` (`has_permission(uid, module, entity, action)`, `has_group(uid, group_code)`, `can_access_record(uid, table, id)`).
- **Realtime**: notificações e atualizações de transferências/pedidos.
- **Edge Functions**:
  - `reordering-cron` (varre pontos de pedido).
  - `auto-purchase-on-shortage` (consome eventos de falta).
  - `module-event-dispatcher` (entrega eventos a assinantes ativos).
- **Design tokens**: paleta Odoo-like profissional (roxo/índigo primário, cinzas neutros, estados semânticos), densidade compacta, tipografia Inter, modo claro primeiro (modo escuro preparado).
- **Padrão de código**: cada módulo em `src/modules/<nome>/` com `routes.ts`, `menu.ts`, `permissions.ts`, `events.ts`, `pages/`, `components/`, `api/`. Registry central em `src/core/modules/registry.ts`.
- **Seeds**: empresa demo, 1 armazém com locais, alguns produtos com variantes e BOM, 2 fornecedores, 2 clientes, grupos e usuário admin.

---

## 10. Fora do escopo deste release (próximos módulos)

- Manufatura/MRP (consumirá BOM e rotas já modeladas).
- Entregas/Transportadoras (plugará no Stock via evento `delivery.ready`).
- Chat interno tipo RAMBU (plugará nas notificações e chatter).
- Faturamento/Contabilidade.
- POS, CRM avançado, e-commerce.

A base é desenhada para que cada um destes entre como um novo módulo plugável, sem reescrever o que está sendo construído agora.
