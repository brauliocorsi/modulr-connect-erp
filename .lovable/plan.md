## Objetivo

Permitir cadastrar e gerenciar a Cama Estofada com 3 atributos (Medida, Tipo de Tecido, Cor), gerando todas as combinações como variantes, com edição em massa de preço/SKU, controle de estoque por variante e foto opcional por variante.

## O que já funciona hoje

- Cadastro de atributos e valores (`/products/attributes`).
- Aba "Variantes" no produto: selecionar atributos e valores, gerar combinações via RPC `generate_product_variants`, editar SKU/código de barras/preço extra/peso/ativo linha a linha.
- Estoque já é por variante (tabelas de estoque referenciam `variant_id`).
- Pedidos de venda permitem escolher variante e somam `price_extra` ao preço.

## O que falta (escopo deste plano)

### 1. Cadastrar os atributos da Cama Estofada (dados, não código)

Antes de qualquer mudança de código, você (usuário) cria em **Produtos → Atributos**:

- **Medida** (Lista) — valores: 190x140, 190x158, 190x188, 200x158, 200x188 (você ajusta).
- **Tipo de Tecido** (Botões) — valores: Suede, Veludo, Linho, Sintético, Boucle.
- **Cor** (Cor) — valores com hex, ex.: Cinza #9CA3AF, Bege #D6C5A8, Preto #111111.

Depois, no produto Cama Estofada → aba Variantes → adiciona os 3 atributos, marca os valores e clica em **Gerar variantes**.

### 2. Melhorias na UI da aba Variantes (`VariantsTab.tsx`)

**a) Edição em massa**
- Adicionar barra de filtros acima da tabela: um `Select` por atributo do produto (ex.: "Medida: todas", "Tecido: Veludo", "Cor: todas") para filtrar as linhas exibidas.
- Adicionar barra de ações em massa que aparece quando há linhas selecionadas (checkbox por linha + checkbox "selecionar todas filtradas"):
  - Definir preço extra (input numérico + botão Aplicar).
  - Adicionar/somar valor ao preço extra atual.
  - Definir peso.
  - Ativar / Desativar.
  - Preencher SKU por padrão (template tipo `CAMA-{medida}-{tecido}-{cor}`, gerando automaticamente para cada linha selecionada usando os nomes dos valores).
- Botão "Exportar CSV" e "Importar CSV" das variantes (opcional, fase 2).

**b) Foto opcional por variante**
- Adicionar coluna "Foto" na tabela. Cada linha mostra miniatura (se houver) e botão para upload/remover.
- Usar bucket de Storage existente para produtos (ou criar `product-variants` se não houver). Salvar URL em `product_variants.image_url`.

**c) Pequenos polimentos**
- Mostrar contador "X selecionadas" e botão "Limpar seleção".
- Ordenar variantes pela combinação (Medida → Tecido → Cor) para facilitar leitura.
- Indicar visualmente variantes inativas (linha em opacidade reduzida).

### 3. Mudanças de banco

- Adicionar coluna `image_url text` em `product_variants` (nullable).
- Garantir bucket de Storage com policies para upload por usuários autenticados com permissão de editar produtos.

### 4. Exibição da foto da variante

- No formulário de pedido (`OrderForm.tsx`), quando a variante for selecionada e tiver foto, mostrar miniatura ao lado do nome.
- Na lista de produtos, manter a foto principal do produto (sem mudança).

## Detalhes técnicos

```text
product_variants
├─ image_url  (NEW, text, nullable)
└─ resto inalterado
```

Filtros do front: derivados de `attrs` carregados em `VariantsTab`. Cada `product_variant_values` traz `value_id` → cruzamos com `attrs[].values[].value_id` para saber a qual atributo pertence cada valor da variante.

Edição em massa: um único `UPDATE ... WHERE id IN (...)` no Supabase por ação aplicada (preço, peso, ativo). Para SKU template, fazemos um `update` por linha porque o valor é diferente para cada uma — usar `Promise.all` com chunks de 20.

Storage: reaproveitar bucket `products` se já existir; senão criar `product-variants` público para leitura, escrita restrita a usuários com permissão `products.products.edit`.

## Fora do escopo (fica para depois)

- Pricelist por combinação de atributos.
- Estoque "sob encomenda" / mix com produção sob demanda.
- Regras automáticas tipo "+R$X por valor de atributo" (você optou por edição em massa em vez disso).

## Entregáveis

1. Migração: coluna `image_url` em `product_variants` + bucket/policies de storage.
2. `VariantsTab.tsx` reescrita com filtros, seleção, ações em massa, gerador de SKU template e upload de foto por linha.
3. Pequena exibição da miniatura da variante no `OrderForm.tsx`.
