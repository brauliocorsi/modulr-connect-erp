## Diagnóstico

Investiguei o recebimento WH/IN/00004 (que não mexeu no stock) e a função `validate_picking`. Encontrei vários bugs que comprometem a consistência:

### Bugs confirmados

1. **PO sem linhas é confirmada** (`confirm_purchase_order`)
   - PO00002 foi confirmada sem linhas → criou um picking de receção vazio (zero `stock_moves`).
   - Validar esse picking não mexe em nada, mas marca como `done`.

2. **`validate_picking` aceita picking sem movimentos**
   - O check actual exige `total_done > 0` apenas se `total_requested > 0`. Se ambos = 0, passa silenciosamente. Daí WH/IN/00004 ficar `done` sem alterar stock.

3. **`validate_picking` não liberta `reserved_quantity` do quant da origem**
   - Decrementa `quantity` mas não decrementa `reserved_quantity`. Resultado real na BD: na localização Stock o quant ficou `quantity=0, reserved_quantity=1` mesmo depois do outgoing concluído. Esse "1" reservado nunca mais sai → bloqueia stock futuro (fantasma).

4. **`validate_picking` cria quants negativos em fornecedor/cliente**
   - Para `incoming` decrementa o quant da localização de fornecedor (ficou `-1`); para `outgoing` incrementa o do cliente. Não é apenas estético: ao reaproveitar o filtro `quantity - reserved_quantity > 0` o sistema pode tentar "reservar" stock virtual.

5. **`create_internal_transfer` deixa o picking em `draft`**
   - Faz reserve mas nunca chama `recalc_picking_state`, então fica `draft` mesmo quando `ready`.

6. **`tg_quant_try_reserve` ignora `internal` e `incoming` pendentes**
   - Só re-reserva moves de pickings `outgoing`. Transferências internas em espera nunca apanham stock libertado.

7. **`confirm_sale_order` / `confirm_purchase_order` não validam quantidade > 0** nas linhas.

8. **`apply_inventory_adjustment`** usa chave de lote inconsistente (`coalesce(lot_id::text,'')` vs UUID nulo no resto do sistema). Funciona, mas pode duplicar quants. Vou normalizar.

## Plano de correção

Tudo é uma migração SQL (sem mudanças de schema, só funções e um cleanup de dados existentes). Não toco em UI.

### Migração — ajustes de funções

**A. `validate_picking`** — reescrever:
- Erro se o picking tiver 0 stock_moves (`Picking sem linhas; adicione produtos antes de validar`).
- Para cada move com `quantity_done > 0`:
  - **Origem**: só atualiza `stock_quants` se a `source_location` for `internal` ou `transit`. Decrementa também `reserved_quantity` no quant em `min(reserved_quantity, quantity_done)` para libertar a reserva consumida.
  - **Destino**: só atualiza quant se `destination_location` for `internal` ou `transit`.
- Para moves com `quantity_done < quantity`, libertar a reserva remanescente (`release_move_reservation_partial`) para o backorder poder re-reservar.
- Mantém criação de backorder e `state='done'`.

**B. `confirm_purchase_order`** — exigir pelo menos uma linha com `quantity > 0`; abortar com mensagem clara caso contrário.

**C. `confirm_sale_order`** — mesma validação para `sale_order_lines` (line_kind='product').

**D. `create_internal_transfer`** — após reservar, chamar `recalc_picking_state(pk_id)`.

**E. `tg_quant_try_reserve`** — alargar filtro: `p.kind IN ('outgoing','internal')` (transferências internas pendentes também devem apanhar stock libertado).

**F. `apply_inventory_adjustment`** — usar chave null-safe consistente: `coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)` (igual ao validate_picking).

### Migração — limpeza de dados existentes

- Para o quant `Stock / produto 218298a2` (e qualquer outro com `reserved_quantity > 0` sem move ativo a sustentar): `UPDATE stock_quants SET reserved_quantity = 0 WHERE reserved_quantity > 0 AND NOT EXISTS (SELECT 1 FROM stock_moves m JOIN stock_pickings p ON p.id=m.picking_id WHERE m.product_id=stock_quants.product_id AND m.source_location_id=stock_quants.location_id AND m.state IN ('draft','waiting') AND p.state NOT IN ('done','cancelled') AND m.reserved_quantity > 0)`.
- Zerar quants negativos em localizações `supplier`/`customer` (ruído de validações antigas).
- Re-executar `reserve_for_move` para todos os moves `waiting/draft` para reaproveitar stock real disponível agora.

## Verificação

Depois da migração:
1. Reabro um picking incoming e valido — confirmo que stock entra e nenhum quant fica negativo no fornecedor.
2. Confirmo uma SO, valido o outgoing — confirmo que `reserved_quantity` zera no quant da origem.
3. Tento confirmar uma PO sem linhas — deve falhar com mensagem clara.
4. Crio uma transferência interna — deve aparecer já como `waiting` ou `ready`, não em `draft`.
5. Faço um inventory adjustment positivo + negativo — `stock_quants` reflete o esperado, sem duplicações.

## O que NÃO muda

- Schema (nenhuma `ALTER TABLE`).
- UI (todas as páginas continuam iguais).
- Fluxo de cadeia (Stock→Cais→Carrinha→Cliente) — só passa a ser consistente.
- Reserva manual / transferência de reserva já implementadas continuam a funcionar.
