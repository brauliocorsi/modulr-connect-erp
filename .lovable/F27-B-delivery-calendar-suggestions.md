# F27-B — Cronograma de Entregas + Sugestão por Código Postal

## Fase 1 — Auditoria de dados

| Dado | Existe | Campo | Qualidade | Fallback |
|---|---|---|---|---|
| Capacity volume viatura | ✅ | `vehicles.usable_volume_m3` (+ `volume_m3`) | bom | `volume_m3` |
| Capacity stops viatura | ✅ | `vehicles.max_stops` | médio | `delivery_routes.cap_deliveries` |
| Capacity montagem viatura | ✅ | `vehicles.assembly_minutes_capacity` (+ `max_assembly_minutes`) | bom | `cap_assembly_minutes` |
| Cap. da rota | ✅ | `delivery_routes.cap_volume_m3 / cap_deliveries / cap_assembly_minutes` | bom | viatura |
| Carga atual da rota | ✅ | `delivery_routes.current_*` | bom | agregar schedules |
| Volume SO/produto | ✅ | `products.volume_m3` (+ `assembly_minutes`) | médio | nulo → "—" |
| Postal code da zona | ✅ | `delivery_zones.zip_from/zip_to` (range) | bom | zona da SO |
| Postal code cliente | ✅ | `partners.zip` | bom | param URL |
| Liga `delivery_routes` → zona | ✅ | `zone_id` | bom | — |
| Liga `delivery_schedules` → SO/rota | ✅ | `sale_order_id` / `route_id` | bom | — |
| Data prevista da venda | ✅ | `sale_orders.commitment_date` | bom | hoje |
| Read-only sem RPC | ✅ | selects via PostgREST | bom | — |

## Fase 2 — Helpers

`src/modules/sales/lib/deliverySchedule.ts`:
- `calculateDayCapacity(date, routes, schedules, saleOrders?)` — agrega slots, volume e montagem com fallback SO; classifica saturação **green/yellow/red/unknown** com thresholds 0.75 / 0.95.
- `suggestDeliveryDays({ postalCode, fromDate, routes, fallbackZoneId, daySaturation, limit })` — filtra rotas por range `zip_from..zip_to`, ordena por capacidade livre → proximidade → saturação. Fallback para zona da SO.

## Fase 3 — Página `/sales/delivery-schedule`

`src/modules/sales/pages/DeliveryScheduleCalendar.tsx`:
- Toggle Mês/Semana, navegação anterior/próximo/Hoje
- Filtros: zona, modo (entrega/levantamento/direto)
- Cards por dia (Odoo-like, densos): entregas, m³, min montagem, chip saturação
- Click abre **Sheet** com:
  - 3 KPIs do dia
  - Rotas planeadas (link a `/routes/:id`)
  - Lista de entregas com cliente, SO link, janela, CP, estado
- Faixa "Dias sugeridos" + halo verde + badge "Recomendado" + tooltip com motivo
- Realtime: `useRealtimeInvalidate` em `delivery_routes`, `delivery_schedules`, `sale_orders` com debounce 500ms

## Fase 4 — Link a partir da SO

`SaleDeliveryPanel`: botão "Ver cronograma" passa `sale_order_id` + `preferred_date` (também presente no estado "sem transferência"). Calendário destaca SO em foco (ring primary).

## Fase 5 — Sugestões por CP

Match por range `zip_from/zip_to` em `delivery_zones`. Sem zona → fallback `fallbackZoneId` (SO). Sem nenhum → lista vazia. Razões formatadas: "Norte já planeada · 11.0 m³ livres", "Zona da encomenda · sem código postal", " · data preferida".

## Fase 6 — Integração visual

- Dias sugeridos: ring esmeralda + badge **Recomendado** + tooltip
- Drawer mostra "Motivo da sugestão" em destaque

## Fase 7 — Realtime

Debounce 500 ms; invalida apenas as 2 queryKeys do range visível.

## Fase 8 — Testes

`src/modules/sales/lib/__tests__/deliverySchedule.test.ts` (10 testes ✅):
1. slots usados ignoram cancelados
2. volume route current + capacidade
3. fallback SO `est_volume_m3`
4. nulos quando capacidade ausente
5/6/7. saturação green / yellow / red
8. prioriza zona por CP
9. ranqueia por capacidade livre
10. proximidade desempate
11. fallback para zona da SO
12. lista vazia sem match nem fallback

**Suite total:** 282/282 ✅ (era 272 + 10).

## Fase 9 — Zero-bypass

```
rg -n "from\(['\"](delivery_routes|delivery_schedules|sale_orders|sale_order_lines|vehicles|delivery_zones|stock_pickings)['\"]\)\.(insert|update|upsert|delete)" \
  src/modules/sales/lib src/modules/sales/pages/DeliveryScheduleCalendar.tsx
```
→ **0 hits**. Página e helpers 100 % leitura.

## Entregue

1. ✅ Auditoria (matriz acima)
2. ✅ Helpers `deliverySchedule.ts`
3. ✅ `DeliveryScheduleCalendar` em `/sales/delivery-schedule`
4. ✅ Menu Vendas atualizado
5. ✅ Botão "Ver cronograma" na SO (presente e ausência de picking)
6. ✅ `suggestDeliveryDays`
7. ✅ Sugestões visuais (halo + badge + tooltip + drawer)
8. ✅ Realtime debounce 500ms
9. ✅ Testes verdes
10. ✅ Zero-bypass

## Backlog (NÃO fazer agora, conforme spec)

- Edição/agendamento a partir do calendário
- Drag/drop de entregas
- Otimização de rota / mapa / geocoding
- Capacidade finita avançada (multi-restrições combinadas)
- Sugestões guardadas/notificadas ao cliente
