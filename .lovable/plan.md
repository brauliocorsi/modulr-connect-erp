
## Objetivo

1. Gerir armazém em hierarquia (Armazém › Zona › Corredor › Rack › Bin) com etiquetas de código de barras.
2. Cada produto pode ser composto por vários **colis** (ex.: Caixa 1/2 + Caixa 2/2). Compras/vendas usam o produto unitário; armazém movimenta os colis.
3. No picking ver: produto + lista de bins com stock + colis a separar (ex.: "Bin A-03-2 · 2× CX 1/2 · 2× CX 2/2").

---

## 1. Hierarquia de localizações

- Página `/inventory/locations` ganha **vista em árvore** (Armazém › Zona › Corredor › Rack › Bin) usando `parent_id` (já existe). Toggle lista/árvore.
- `LocationForm` ganha campos: tipo do nível (Zona/Corredor/Rack/Bin), `is_bin`, `barcode` editável, botão **Imprimir etiqueta** (PDF com código de barras).
- Ação em massa: **Gerar bins** numa rack (ex.: A-01 a A-10) cria filhos automaticamente com barcodes sequenciais.

## 2. Colis por produto (multi-pacote)

Nova tabela **`product_packages`** (1 produto → N colis):
- `product_id`, `sequence` (1, 2…), `label` ("Caixa 1/2"), `barcode` único, `weight_kg`, `notes`.

Comportamento:
- **Compras / Vendas**: continuam a usar a unidade do produto. Sem alteração no `sale_order_lines` / `purchase_order_lines`.
- **Receção (incoming picking)**: o operador faz scan dos barcodes dos colis. Sistema agrupa: 1 unidade do produto = 1 scan de cada `sequence`. Mostra checklist por unidade ("CX 1/2 ✓ · CX 2/2 ✗"). Só fecha a linha quando todos os colis foram scaneados Q vezes.
- **Picking de saída**: a linha mostra o produto + expansão com a lista de colis a apanhar (qtd × cada `label`), cada um com a sua bin sugerida.
- Stock interno é por **colis** (ver secção 3) — mas o saldo "vendável" mostrado em listas é `floor(min(stock_colis_i) / 1)` para garantir produtos completos.

## 3. Stock por bin (manual no picking)

- `stock_quants` já suporta vários registos por (produto, location). Vamos passar a registar quants por **package_id** quando o produto tem colis: nova coluna nullable `package_id` em `stock_quants` e em `stock_moves`.
- Receção grava um quant por colis na bin escolhida pelo operador (sem putaway automático — escolha manual com sugestão da última bin usada para esse colis).
- Picking de saída: o operador vê uma tabela "Onde apanhar" — todas as bins com stock daquele colis, ordenadas por última atualização. Ele confirma a bin (ou faz scan) e regista a quantidade.
- `stock_quants` mantém-se como hoje quando o produto **não** tem `product_packages` (comportamento atual preservado).

## 4. UI principais alterações

- **Produto › aba "Colis"**: CRUD de `product_packages` com impressão de etiquetas dos códigos de cada colis.
- **Receção (`TransferForm` kind=incoming)**: ao expandir uma linha cujo produto tem colis, surge subgrelha "Caixas a receber" com scan/contador por colis e seletor de bin.
- **Picking saída/interno**: subgrelha "Apanhar de" com bins disponíveis (nome + barcode + stock) por colis; botão "Sugerir bin" usa a com mais stock.
- **Mapa de stock por bin** (rota nova `/inventory/bins`): tabela bin × produto × colis × qtd. Pesquisa por bin/barcode.

## 5. Detalhes técnicos

- Migração:
  - `CREATE TABLE product_packages (id, product_id, sequence, label, barcode UNIQUE, weight_kg, notes, created_at)` com RLS herdada de products.
  - `ALTER TABLE stock_quants ADD COLUMN package_id uuid REFERENCES product_packages(id)`.
  - `ALTER TABLE stock_moves ADD COLUMN package_id uuid REFERENCES product_packages(id)`.
  - View `v_product_sellable_qty` = min por colis para mostrar stock "completo" em vendas.
- `validate_picking` adaptado: ao gravar quants, usa `package_id` se presente; caso contrário comportamento atual.
- `LocationsList` ganha modo árvore (componente novo `LocationsTree`) usando `parent_id`.
- Etiquetas: reutilizar `printBarcodes.ts` existente, alimentado com `name + barcode`.

## 6. Fora deste plano

- Putaway automático / estratégias por categoria (já existe `putaway_rules`, mantém-se mas não é alterado).
- Multi-armazém transfer entre bins via app barcode (separado, futuro).
- Conversão automática colis→unidade noutros módulos além de receção/picking.

## Aprovação

Confirma que este desenho cobre o teu caso (especialmente: 1 unidade do produto = N scans de colis distintos na receção; venda/compra continuam unitárias; bin escolhida manualmente no picking)?
