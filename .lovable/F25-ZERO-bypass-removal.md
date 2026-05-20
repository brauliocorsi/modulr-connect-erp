# F25-ZERO — Últimos Bypasses Legados Removidos

## Auditoria inicial

| Arquivo | Tabela | Operação | RPC existente? | Ação |
|---|---|---|---|---|
| `src/modules/discuss/Discuss.tsx:120` | `chat_messages` | `insert` | Não (conversation_send_message escreve em `conversation_messages`, não em `chat_messages` legado lido pelo Discuss) | Criar `discuss_send_message` |
| `src/modules/barcode/PickingScan.tsx:71` | `stock_moves` | `update {quantity_done:0}` | Não (RPCs `scan_*` operam um move por vez) | Criar `picking_scan_reset_quantity_done` |

## Migrations

### `discuss_send_message(_channel_id, _body, _image_url, _mentions)` → uuid
- SECURITY DEFINER, `search_path=public`.
- Exige `auth.uid()`.
- Valida canal existente, body/imagem não vazios.
- Verifica membership; canais privados rejeitam não-membros; públicos auto-juntam o autor.
- Insere em `chat_messages` (que dispara `discuss_bridge_message_to_conversation` → mirror para `conversation_messages`, mantendo `GlobalChatDock` e unified list intactos).
- GRANT EXECUTE para `authenticated`.

### `picking_scan_reset_quantity_done(_picking)` → integer
- SECURITY DEFINER, `search_path=public`.
- Exige `auth.uid()`.
- Valida picking existente e estado ≠ done/cancelled.
- Faz `UPDATE stock_moves SET quantity_done=0 WHERE picking_id=_p AND state NOT IN ('done','cancelled')`.
- Retorna número de linhas afetadas.
- GRANT EXECUTE para `authenticated`. Não toca `stock_quants` nem motor de reservas.

## Frontend

- `Discuss.tsx` `sendMessage` agora chama `supabase.rpc("discuss_send_message", { _channel_id, _body, _image_url, _mentions })`.
- `PickingScan.tsx` `openPicking` agora chama `supabase.rpc("picking_scan_reset_quantity_done", { _picking: id })`.

## Zero-bypass final

```
rg "from\(['\"](chat_messages|conversation_messages|conversation_threads|record_messages|stock_moves|stock_quants|stock_packages|customer_payments|cash_movements|sale_orders|purchase_orders|manufacturing_orders|delivery_routes)['\"]\)\.(insert|update|upsert|delete)" src/
→ 0 hits
```

## Testes

- `bunx vitest run` → **256/256 passed** (50 files).
- Sem regressões em Discuss, Picking, Chat unified, GlobalChatDock, MessagesBell, finance ou stock.

## Backlog
- Nenhum P0/P1 remanescente neste escopo. Bridge legado `chat_messages → conversation_messages` permanece como contrato de compatibilidade até depreciação completa do Discuss legacy.
