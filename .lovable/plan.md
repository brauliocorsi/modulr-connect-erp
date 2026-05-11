# Transferência manual de reserva entre vendas

## Objetivo
Permitir que o utilizador escolha **explicitamente** qual SO destino recebe N unidades reservadas de outra SO, em vez de depender só da realocação automática por antiguidade. A reserva continua a acontecer apenas na confirmação da venda (sem alteração).

---

## 1. Função SQL nova: `transfer_reservation`

Assinatura:
```
transfer_reservation(
  _from_move uuid,    -- stock_move da SO origem
  _to_so uuid,        -- SO destino
  _qty numeric,       -- quantidade a transferir
  _reason text        -- motivo (opcional)
) RETURNS jsonb
```

Comportamento:
1. Valida que `_from_move` pertence a SO confirmada, picking não `done/cancelled`, e `reserved_quantity >= _qty`.
2. Localiza na SO destino um `stock_move` do **mesmo `product_id` + `variant_id` + armazém** com `state IN ('draft','waiting')` e capacidade livre (`quantity - reserved_quantity >= _qty`). Se não houver, devolve erro claro ("SO destino não tem linha pendente compatível").
3. **Decrementa** `reserved_quantity` no move origem (e nos `stock_quants` correspondentes via `release_move_reservation` parcial — nova helper `release_move_reservation_partial(_move, _qty)`).
4. Chama `reserve_for_move(destino, _qty)` para reservar imediatamente nos mesmos quants libertados.
5. Recalcula `recalc_picking_state` e `recalc_so_fulfillment` para ambas as SOs.
6. Notifica vendedores das duas SOs (`notify_user`) e regista entrada no chatter de cada uma com motivo.
7. Devolve `{from_so, to_so, qty, reason}`.

Garantias:
- Não permite transferir para SOs canceladas, em rascunho ou já cumpridas.
- Operação atómica (uma transação): se a re-reserva no destino falhar, faz rollback.
- Respeita RLS: só utilizadores com `has_permission('sales','orders','edit')` podem executar (verificação dentro da função).

## 2. Helper: `release_move_reservation_partial`

Liberta apenas `_qty` em vez de tudo. Itera os `stock_quants` reservados pelo move (via `stock_move_lines` se existirem, senão por dedução do quant do armazém) e decrementa proporcionalmente. Mantém o move ativo com `reserved_quantity` reduzido.

## 3. UI — Botão "Transferir reserva"

Localização: `TransferForm.tsx` (detalhe do picking de saída) e `OrderForm.tsx` (linha da SO em estado reservado/parcial).

Diálogo:
- Mostra produto + variante + quantidade reservada disponível para transferir.
- **Combo de SOs candidatas**: query a `sale_orders` filtradas por:
  - `state IN ('confirmed','sent')`
  - `fulfillment_status IN ('pending','ordered','partial_available','backordered')`
  - tem `stock_move` do mesmo produto/variante/armazém com falta de stock.
  - ordenadas por `date_order` ASC (mais antiga primeiro), com badge "mais antiga".
- Campo quantidade (max = reservado disponível e max da necessidade da SO destino).
- Campo motivo (livre).
- Botão **Transferir** chama RPC `transfer_reservation`.

## 4. Visibilidade
- Chatter de ambas as SOs: "Reserva transferida: 5 unid. de SO/00012 → SO/00045 (motivo: cliente VIP)".
- Notificação aos dois vendedores.
- Coluna/badge no `TransfersList` quando picking teve transferências (campo `reservation_transfer_count` opcional para auditoria — adicionar a `stock_pickings`).

## 5. Sem alteração no momento de reserva
Mantém-se o atual: `confirm_sale_order` continua a ser o único trigger automático de reserva. A transferência manual é uma ação adicional, opcional.

---

## Detalhes técnicos

**Migração:**
- `CREATE FUNCTION transfer_reservation(...)`
- `CREATE FUNCTION release_move_reservation_partial(_move, _qty)`
- `ALTER TABLE stock_pickings ADD COLUMN reservation_transfer_count int DEFAULT 0`

**Frontend novo/alterado:**
- `src/modules/inventory/components/TransferReservationDialog.tsx` (novo)
- `src/modules/inventory/pages/TransferForm.tsx` — botão "Transferir reserva" no header do picking quando há `reserved_quantity > 0`.
- `src/core/orders/OrderForm.tsx` — ação por linha (menu "⋮ Transferir reserva") quando linha tem reserva ativa.

**Fluxo de erro a tratar na UI:**
- "SO destino não tem linha pendente compatível" → sugerir adicionar linha primeiro.
- "Quantidade superior à reservada disponível" → input bloqueia.
- Concorrência (alguém validou o picking entretanto) → toast com refresh.
