Refino do plano "Arrumar" anterior, com colis em bins diferentes, localização sempre visível no picking, e ação de arrumação também disponível fora da app de códigos de barras.

## 1. App de Código de Barras — modo "Arrumar"

Nova página `/barcode/putaway` (tile laranja na home + entrada no menu).

### Fluxo de scan, agora colis-a-colis

```text
1. Bipar COLIS (ou produto sem colis)   → seleciona item
2. Bipar LOCALIZAÇÃO (bin)              → grava ESSE colis nessa bin
3. Bipar próximo COLIS                  → pode ser outro colis do mesmo produto
4. Bipar nova LOCALIZAÇÃO               → o segundo colis vai para outra bin
... 
OK / ESC para terminar ou cancelar.
```

Diferença chave face ao plano anterior: **cada colis é arrumado individualmente**, podendo ir para uma bin diferente. Para produtos sem colis, comporta-se como antes (produto + qty + bin).

### RPC `putaway_stock(_product, _package, _qty, _location)`

- `package_id` opcional. Quando fornecido, atualiza `stock_quants` filtrando por `(product_id, package_id, location_id)`.
- Cria `stock_moves` interno `done` com `package_id` para auditoria.
- Origem = local virtual de stock do armazém da localização destino.
- Valida que destino é `is_bin = true`.

## 2. Localização sempre visível

### No picking (app de códigos de barras — `PickingScan.tsx`)

Para cada movimento:
- Mostra a **localização origem do quant** onde o stock está. Quando há colis em várias bins, lista cada colis com a sua bin (ex.: `Caixa 1/2 → A-01-03 · Caixa 2/2 → B-04-12`).
- Linha de cabeçalho do movimento mostra a bin sugerida com mais stock.

### Na lista de picking impressa (`printPickingList.ts`)

Coluna nova "Local" no quadro principal e, dentro do bloco de colis, coluna "Local" com o barcode da bin (CODE128) para o operador bipar.

### Em outros sítios

- `BinsPage` e `LocationsTreePage` já mostram, mas adicionam contagem por colis.
- `ProductLookup` (consulta na app barcode) passa a listar quants por (bin, colis).

## 3. Arrumar fora da app de códigos de barras

Adicionar ação no UI normal:

- **No formulário do Produto** → tab "Stock", botão **"Arrumar em local"**: dialog com select de armazém, bin destino, colis (se aplicável) e quantidade. Chama a mesma RPC `putaway_stock`.
- **Na página `LocationsTreePage`** (vista hierárquica) → ao abrir uma bin, botão **"+ Arrumar produto"**: dialog com produto/colis/qty.
- **Na `BinsPage`** → ação por linha "Arrumar mais" e "Mover".

Reutilizam a mesma RPC e o mesmo componente `PutawayDialog`.

## Ficheiros tocados

- Novos: `src/modules/barcode/PutawayScan.tsx`, `src/modules/inventory/PutawayDialog.tsx`
- Editados: `BarcodeHome.tsx`, `BarcodeShell.tsx`, `App.tsx`, `registry.ts`, `PickingScan.tsx`, `printPickingList.ts`, `ProductLookup.tsx`, `LocationsTreePage.tsx`, `BinsPage.tsx`, `tabs/StockTab.tsx`
- Migração: RPC `putaway_stock` (suporta `package_id` nullable)

## Fora do âmbito

- Sugestão automática de bin (continua manual).
- Movimentações entre duas bins (já cobertas por Transferência interna).
