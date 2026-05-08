# Plano: Entrega e Montagem nos Pedidos de Venda

## Objetivo
Permitir que o pedido de venda calcule automaticamente:
- **Montagem**: somatório do "valor de montagem" definido em cada produto (quando o cliente pede montagem).
- **Entrega**: valor calculado a partir do código postal do cliente, com fallback por região, e adicional opcional por produto.

Ambos aparecem como linhas separadas no pedido e no PDF de impressão.

## 1. Cadastro de Produto (`ProductForm.tsx`)

Nova secção "Serviços":
- `assembly_fee` (numérico, €) — valor de montagem unitário por produto.
- `delivery_surcharge` (numérico, €) — adicional de entrega por unidade (ex.: produto volumoso).

Estes campos são opcionais e ignorados em produtos sem necessidade.

## 2. Regras de Entrega (nova área em Vendas → Configuração)

Duas tabelas geríveis pelo utilizador:

**a) `delivery_zip_rules`** — faixas de código postal portuguesas
- `zip_from` (text, ex.: "1000")
- `zip_to` (text, ex.: "1999")
- `price` (numérico)
- `label` (ex.: "Lisboa centro")
- `active`

**b) `delivery_region_rules`** — fallback por região/distrito
- `region` (text, ex.: "Lisboa", "Porto", "Algarve")
- `country` (default 'PT')
- `price`
- `active`

**Lista UI**: tabela editável estilo `ListView` com criar/editar/desativar. Acessível em `/sales/delivery-rules`.

## 3. Lógica de Cálculo

Função no banco `calc_delivery_price(_partner uuid, _country text default 'PT')`:
1. Lê `partners.zip` (formato PT: "XXXX-XXX" ou "XXXX").
2. Procura em `delivery_zip_rules` por faixa que contenha o prefixo de 4 dígitos.
3. Se não encontrar, procura em `delivery_region_rules` por `partners.state` (distrito).
4. Retorna o preço base (ou 0 se nada match).

No frontend (`OrderForm.tsx`), a entrega total = `preço_base_zona + Σ (linha.qty × produto.delivery_surcharge)`.

## 4. UI do Pedido (`OrderForm.tsx`)

Novo painel "Serviços" no cabeçalho do pedido, após linhas de produto:

```text
[ ] Incluir montagem        Total montagem: 120,00 €  (auto)
[x] Incluir entrega         Zona: Lisboa (1000-1999)  35,00 €
                            Adicional produtos:        15,00 €
                            Total entrega:             50,00 €
[ Recalcular ]
```

Comportamento:
- Toggle **Montagem**: quando ativo, soma `Σ (qty × produto.assembly_fee)` das linhas.
- Toggle **Entrega**: quando ativo, calcula via regras + adicionais de produto.
- Recalcula automaticamente ao alterar linhas, cliente ou toggles.
- Cada serviço gera/atualiza uma **linha de pedido especial** (campo `line_kind` = `'assembly'` ou `'delivery'`), que o utilizador pode ver mas não editar manualmente (apenas remover desativando o toggle).

## 5. Mudanças de Banco

```text
products
├─ assembly_fee numeric default 0
└─ delivery_surcharge numeric default 0

sale_orders
├─ include_assembly boolean default false
├─ include_delivery boolean default false
└─ delivery_zone_label text  (informativo, ex.: "Lisboa 1000-1999")

sale_order_lines
└─ line_kind text default 'product'  -- 'product' | 'assembly' | 'delivery'

NOVA: delivery_zip_rules (zip_from, zip_to, price, label, active)
NOVA: delivery_region_rules (region, country, price, active)

NOVA RPC: calc_delivery_price(_partner, _country) returns numeric
NOVA RPC: refresh_order_services(_order) returns void
   -- recria linhas 'assembly' e 'delivery' com base nos toggles e produtos
```

RLS: `delivery_*_rules` legível por todos autenticados; escrita exige permissão `sales.config.edit` (reusa group existente).

## 6. PDF de Venda (`printSaleOrder.ts`)

Na secção de linhas, separar visualmente:
- **Produtos** (atual)
- **Serviços** — bloco próprio listando "Entrega — zona X" e "Montagem", com subtotais.
- Total continua somando tudo.

## 7. Localização

Garantir que toda nova UI usa pt-PT consistentemente ("Código Postal", "Distrito", "Montagem", "Entrega").

## Entregáveis

1. **Migração**: colunas em `products`, `sale_orders`, `sale_order_lines`; tabelas `delivery_zip_rules` e `delivery_region_rules`; funções `calc_delivery_price` e `refresh_order_services`; RLS.
2. **`ProductForm.tsx`**: secção Serviços com `assembly_fee` e `delivery_surcharge`.
3. **Nova página** `/sales/delivery-rules` com 2 abas (CP / Região) usando `ListView`.
4. **`OrderForm.tsx`**: painel Serviços + toggles + chamada à RPC `refresh_order_services`.
5. **`printSaleOrder.ts`**: bloco "Serviços" no PDF.
6. **Menu Vendas**: entrada "Regras de Entrega".

## Fora do escopo
- Integração com transportadoras externas (CTT, DPD).
- Janelas horárias / agendamento de entrega.
- Cálculo por peso/volume (apenas adicional fixo por produto).
