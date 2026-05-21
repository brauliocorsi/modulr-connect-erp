# F26-A — Realtime Infrastructure + Operational Event Stream

## 1. Audit (polling × realtime)

| Área                       | Polling antes        | Realtime existente                     | Estado pós F26-A                          | Prioridade |
|----------------------------|----------------------|----------------------------------------|-------------------------------------------|------------|
| GlobalChatDock             | `setInterval` 20 s   | conversation_messages / chat_messages  | **Polling removido** + visibility refetch | P0 ✔       |
| NotificationsBell          | nenhum               | notifications                          | ok                                        | P0 ✔       |
| MessagesBell               | nenhum               | chat_messages / chat_channel_members   | ok                                        | P0 ✔       |
| RecordConversations        | nenhum               | conversation_messages                  | ok                                        | P0 ✔       |
| RecordTimeline             | nenhum               | activity_events                        | ok                                        | P0 ✔       |
| RecordTasks                | nenhum               | erp_tasks                              | ok                                        | P0 ✔       |
| OrderForm                  | nenhum               | sale_orders/lines + stock_pickings/moves + stock_quants | ok                       | P1 ✔       |
| PurchaseBillsPanel         | nenhum               | supplier_bills / supplier_payments     | ok                                        | P1 ✔       |
| TransferForm (WMS)         | nenhum               | stock_pickings/moves/sale/purchase     | ok                                        | P1 ✔       |
| CustomerTicketDetail       | nenhum               | tickets + activities                   | ok                                        | P1 ✔       |
| Discuss                    | nenhum               | chat_messages / chat_channel_members   | ok                                        | P1 ✔       |
| Chatter                    | nenhum               | postgres_changes                       | ok                                        | P1 ✔       |
| ActivitiesPanel            | nenhum               | record_activities                      | ok                                        | P1 ✔       |
| OperationalEventsPage      | —                    | **NOVO** activity_events INSERT        | **NOVO**                                  | —          |
| PaymentsPage               | nenhum               | —                                      | backlog F26-B                             | P1         |
| PickingScan                | nenhum               | —                                      | backlog F26-B                             | P1         |
| RouteDetail                | nenhum               | —                                      | backlog F26-B                             | P1         |
| ManufacturingOrderDetail   | nenhum               | —                                      | backlog F26-B                             | P1         |
| Indicators / Home          | refetch on demand    | —                                      | backlog F26-B                             | P2         |
| LastUpdated (relative ts)  | `setInterval` 30 s   | —                                      | mantido (apenas re-render do "há X seg")  | —          |
| useScanner (refocus loop)  | `setInterval` 1.5 s  | —                                      | mantido (DOM focus, sem rede)             | —          |

Conclusão: o ERP já tinha realtime na maior parte do tráfego operacional.
O único polling de rede ativo era o `setInterval` de 20 s do GlobalChatDock —
**removido nesta fase**.

## 2. Entregas

1. `src/core/realtime/useRealtimeChannel.ts` — hook central com
   - subscribe múltiplo de filtros num único canal
   - debounce (default 250 ms) para evitar refetch storm
   - unsubscribe garantido no unmount
   - try/catch em subscribe — nunca derruba a UI
   - no-op silencioso se `supabase.channel` não existir (testes)
2. `src/core/realtime/useRealtimeInvalidate.ts` — açúcar que invalida
   chaves React Query alvo a alvo (targeted invalidation).
3. `src/core/realtime/index.ts` — barrel.
4. `src/core/realtime/__tests__/useRealtimeChannel.test.tsx` — testes de
   subscribe/unsubscribe, enabled=false, e debounce.
5. `src/modules/activity/pages/OperationalEventsPage.tsx` — feed global em
   `/activity/events`, lendo `activity_events` com realtime INSERT,
   filtros por entidade e busca livre.
6. Rota `/activity/events` adicionada em `src/App.tsx`.
7. `GlobalChatDock`: `POLL_MS` e `setInterval` removidos; refetch único no
   mount + catch-up no `visibilitychange`. Realtime continua intacto.

## 3. Zero-bypass

Nenhum write novo. `useRealtimeChannel` faz apenas `supabase.channel(...)
.on('postgres_changes', ...)` — read-only. Confere com a regra F25-ZERO.

## 4. Performance / segurança

- Channels nomeados por contexto (`global-chat-${user.id}`, `operational-events-feed`).
- Debounce coalesce rajadas.
- Unsubscribe em cleanup garantido.
- RLS preservada (subscriptions herdam policies de SELECT da tabela).
- Sem novos schemas, triggers ou migrations.

## 5. Backlog F26-B (próxima fase)

- Migrar `OrderForm`, `TransferForm`, `PurchaseBillsPanel`, `RecordTimeline`,
  `RecordTasks` para usar `useRealtimeChannel` (uniformizar — funcional já).
- Adicionar realtime a: `PaymentsPage`, `PickingScan`, `RouteDetail`,
  `ManufacturingOrderDetail`, `Indicators`, `Home`.
- `useRealtimePresence` (typing/online) — adiar até necessidade real.
- Fallback polling automático em caso de erro persistente do canal.
- Enriquecer `activity_log_event` com `module` e `severity` em metadata
  (sem migration pesada — extender RPC futura).
