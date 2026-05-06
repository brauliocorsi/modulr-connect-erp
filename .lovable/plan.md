# Plano — Produto Completo (estilo Odoo) com preparação WooCommerce

## Objetivo
Expandir o módulo de Produtos para ter paridade funcional com o Odoo (variantes, BOM/kits, stock previsto, fornecedores, etiquetas, medidas, preços por variante) e deixar a base preparada para sincronização futura com WooCommerce.

---

## 1. Cadastro completo do produto

Expandir `ProductForm.tsx` (já existente) com novas abas/secções:

**Aba Geral** (já existe — completar)
- Nome, Referência interna (SKU), Código de barras (EAN/UPC), Tipo, Categoria, Etiquetas, UoM venda, UoM compra, Imagem.

**Aba Vendas**
- Preço de venda, Imposto, Tabelas de preço, Política de faturação.
- Descrição comercial (rich text).

**Aba Compras**
- Custo padrão, fornecedores (já tem `product_suppliers`) — UI tabular: parceiro, SKU fornecedor, preço, qtd mínima, lead time, prioridade.
- Descrição de compra.

**Aba Inventário**
- Rastreamento (none/lot/serial), Estratégia de remoção (FIFO/LIFO).
- **Medidas físicas**: peso (kg), volume (m³), altura, largura, profundidade (cm), peso bruto, peso líquido — campos novos.
- Rotas (comprar/fabricar), regras de reabastecimento (link).

**Aba Variantes**
- Atributos do produto + valores (Tamanho: P/M/G; Cor: Vermelho/Azul…).
- Geração automática de variantes (cartesiano) com SKU/barcode/preço extra por variante.
- `price_extra` por valor de atributo (preço final = list_price + Σ extras).

**Aba BOM / Kit**
- Listar BOMs do produto. Tipo: `normal` (manufatura), `phantom` (kit — explode no pedido), `subcontract`.
- Linhas: componente, variante, quantidade, UoM.
- Operações (centro de trabalho, duração) — opcional.
- **Produto composto / kit**: tipo `phantom` para vender como conjunto.

**Aba Stock (somente leitura)**
- Stock atual (à mão), Reservado, Disponível.
- **Stock previsto** = Disponível + Recebimentos pendentes (POs confirmadas) − Saídas pendentes (SOs confirmadas).
- **Stock vendido** = Σ qtd em SOs `confirmed`/`done` (período configurável).
- Por armazém, com drill-down.

**Aba WooCommerce** (preparação)
- Toggle "Publicar no WooCommerce".
- Campos: `woo_product_id`, `woo_sync_status`, `woo_last_sync_at`, slug, short_description, categorias Woo, visibilidade, status (draft/publish).
- UI mostra estado mas sincronização real fica para passo posterior (após conectar credenciais Woo).

---

## 2. Etiquetas (Tags)

Nova tabela `product_tags` (id, name, color) + pivô `product_tag_rel`.
Componente de chips multi-select no formulário, filtros na lista.

---

## 3. Variantes — Geração e preços

- UI em `ProductForm` aba Variantes:
  - Adicionar atributo → escolher valores → "Gerar variantes".
  - Tabela editável de variantes geradas: SKU, barcode, preço extra, ativo, imagem opcional.
- Lógica:
  - `product_template_attributes` + `product_template_attribute_values` (já existem) → gera linhas em `product_variants` + `product_variant_values`.
  - Função SQL `generate_variants(product_id)` que faz produto cartesiano e cria/limpa variantes inativas.
- Pedido de venda: ao escolher produto com variantes, mostrar selectors de atributos → resolve `variant_id`; preço = `list_price` + Σ `price_extra`.

---

## 4. BOM / Kit (phantom) na venda

- Ao confirmar SO com linha cujo produto tem BOM `phantom` ativa: explodir em movimentos de stock dos componentes (não do produto kit).
- Ajustar `confirm_sale_order` para detectar phantom e gerar moves dos componentes.
- BOM `normal`: usado por módulo Manufatura (futuro) — apenas cadastro agora.

---

## 5. Stock previsto / vendido

**View SQL** `product_stock_forecast`:
```
product_id, warehouse_id,
on_hand, reserved, available,
incoming (Σ POs confirmed não recebidas),
outgoing (Σ SOs confirmed não entregues),
forecasted = available + incoming − outgoing,
sold_30d, sold_90d
```

Exibido na aba Stock e em coluna opcional na lista de produtos.

---

## 6. Fornecedores vinculados (já parcial)

UI tabular completa em `ProductForm` aba Compras usando `product_suppliers`:
- Adicionar/remover linhas, ordenar por prioridade (drag).
- Reabastecimento já usa o fornecedor de menor prioridade (função `run_reordering_rules`).

---

## 7. Preparação WooCommerce

**Schema** (apenas estrutura agora, sem sincronização):
- Adicionar a `products`: `woo_product_id bigint`, `woo_sync_status text`, `woo_last_sync_at timestamptz`, `woo_slug text`, `woo_status text default 'draft'`, `short_description text`, `published_woo boolean default false`.
- Adicionar a `product_variants`: `woo_variation_id bigint`, `woo_sync_status text`.
- Tabela `woo_categories` (id, woo_id, name, parent_id) e pivô `product_woo_categories`.
- Tabela `woo_sync_log` (entity_type, entity_id, action, status, error, created_at).

**Edge function placeholder** `woo-sync` (criada vazia, retorna "not configured") — quando o utilizador fornecer URL/consumer_key/secret da loja Woo, ativamos via `add_secret`.

---

## 8. Migrações SQL (resumo)

1. `ALTER products` — adicionar `height, width, depth, gross_weight, net_weight, barcode, short_description` e campos Woo.
2. `ALTER product_variants` — adicionar campos Woo + `weight, barcode` se faltar.
3. `CREATE TABLE product_tags`, `product_tag_rel` + RLS.
4. `CREATE TABLE woo_categories`, `product_woo_categories`, `woo_sync_log` + RLS.
5. `CREATE OR REPLACE FUNCTION generate_variants(_product uuid)` — gera variantes a partir dos atributos.
6. `CREATE VIEW product_stock_forecast` — stock previsto/vendido.
7. Atualizar `confirm_sale_order` — explodir BOM phantom.

---

## 9. Ficheiros a criar/editar

**Criar**
- `src/modules/products/pages/VariantsTab.tsx`
- `src/modules/products/pages/SuppliersTab.tsx`
- `src/modules/products/pages/BomTab.tsx`
- `src/modules/products/pages/StockTab.tsx`
- `src/modules/products/pages/WooTab.tsx`
- `src/modules/products/components/TagPicker.tsx`
- `supabase/migrations/..._product_full_woo.sql`
- `supabase/functions/woo-sync/index.ts` (placeholder)

**Editar**
- `src/modules/products/pages/ProductForm.tsx` — integrar todas as abas.
- `src/modules/products/pages/ProductsList.tsx` — colunas de stock previsto, etiquetas, filtros.
- `src/core/orders/OrderForm.tsx` — selector de variante + resolução de preço.

---

## Fora do âmbito (pode ficar para depois)
- Sincronização efetiva WooCommerce (requer URL + chaves da loja).
- Módulo Manufatura completo (ordens de produção). BOM `normal` apenas cadastrada.
- Configurador avançado tipo Odoo "no_variant" attributes.

Após aprovação implemento tudo de uma vez. Diga se quer ativar a sincronização Woo agora (preciso URL da loja + Consumer Key/Secret) ou deixar só a preparação.