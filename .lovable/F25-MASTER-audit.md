# F25-MASTER — Auditoria Final de Cobertura + Integração Cruzada

Data: 2026-05-20  
Resultado tests: **256/256 verdes** · zero-bypass: **2 hits legados** (P1, ver §3)

---

## 1. Matriz de cobertura

| # | Módulo | Backend | Frontend | Menu | Ações | Testes | Gap | Prio |
|---|---|---|---|---|---|---|---|---|
| 1 | Vendas | ✅ | ✅ | ✅ | ✅ RPC | ✅ | — | — |
| 2 | Pagamentos cliente | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| 3 | Caixa físico | ✅ | ✅ | ✅ | ✅ (RPCs sessões) | ✅ | — | — |
| 4 | Conciliação bancária | ✅ | ✅ `/finance/reconciliation` | ⚠️ → ✅ adicionado ao menu | ✅ | ✅ | menu faltava | **fix neste bloco** |
| 5 | Compras | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| 6 | Contas a pagar | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| 7 | Stock / WMS | ✅ | ✅ | ⚠️ shipments/internal/backorders sem menu → ✅ adicionado | ✅ | ✅ | menu | **fix neste bloco** |
| 8 | Colis (pickups + carrier) | ✅ | ✅ `/m5/*` | ✅ | ✅ | ✅ | — | — |
| 9 | Danificados | ✅ | ✅ F25-A | ✅ | ✅ (open repair / scrap) | ✅ | — | — |
| 10 | Quarentena | ✅ | ✅ F25-A | ✅ | ✅ release/scrap | ✅ | — | — |
| 11 | Produção | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| 12 | Centros trabalho | ✅ | ✅ CRUD F25-B | ✅ | ✅ upsert/archive | ✅ | — | — |
| 13 | Operações | ✅ | ✅ CRUD F25-B | ✅ | ✅ | ✅ | — | — |
| 14 | Máquinas | ✅ F25-B | ✅ CRUD | ✅ | ✅ | ✅ | — | — |
| 15 | Ordens fabrico | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| 16 | Rotas/entregas | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| 17 | Assistência/RMA | ✅ | ✅ F25-A | ✅ | ✅ repair/dispose/release | ✅ | — | — |
| 18 | Helpdesk | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| 19 | Portal Cliente | ✅ | ✅ `/portal/:token` + tokens admin | ✅ | ✅ | ✅ | — | — |
| 20 | Chat/Discuss | ✅ unified | ✅ Dock + Discuss | ✅ | ✅ RPCs unified | ✅ | `Discuss.tsx` legacy insert (ver §3) | P1 |
| 21 | Tarefas | ✅ | ✅ RecordTasks | (sidebar registro) | ✅ | ✅ | — | — |
| 22 | Timeline | ✅ | ✅ RecordTimeline | (sidebar registro) | ✅ | ✅ | — | — |
| 23 | Indicadores | ✅ | ✅ `/indicators` | ✅ (sidebar global) | ✅ | ✅ | — | — |
| 24 | Permissões/RLS | ✅ F24-D + D1 | ✅ users/stores/groups | ✅ | ✅ RPCs | ✅ | — | — |
| 25 | Settings/Admin | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |

---

## 2. Mudanças aplicadas neste bloco (P1)

Frontend-only (sem migration, sem RPC nova):

- **Inventory menu**: adicionados `Expedições` (`/inventory/shipments`), `Transferências internas` (`/inventory/internal-transfers`) e `Backorders` (`/inventory/backorders`). Páginas já existiam, sem link de navegação.
- **Finance menu**: adicionados `Conciliação Bancária` (`/finance/reconciliation`) e `Créditos de Cliente` (`/finance/credits`). Páginas já existiam.

Resultado: cobertura visual 100% das rotas operacionais top-level que tinham backend pronto.

---

## 3. Zero-bypass — hits remanescentes

`rg` em writes diretos para tabelas críticas:

| Arquivo | Linha | Tabela | Operação | Avaliação |
|---|---|---|---|---|
| `src/modules/discuss/Discuss.tsx` | 120 | `chat_messages` | insert | **P1** — substituir por `conversation_message_post`/equivalente unified (F24-C deixou esta página como legacy fora do escopo do dock). Não bloqueia uso atual: RLS endurecida em F24-D já protege a tabela. |
| `src/modules/barcode/PickingScan.tsx` | 71 | `stock_moves` | update `quantity_done=0` | **P1** — converter para RPC `stock_move_reset_done` (a criar). Hit isolado, mobile-only. |

Nenhum hit P0. Tudo o que é financeiro, sessões de caixa, pagamentos, bills, MOs, máquinas, work centers, operations, conversation_*, user_store_assignments, profiles, user_groups passa por RPC `SECURITY DEFINER`.

---

## 4. Cruzamentos validados

| Fluxo | Status |
|---|---|
| Vendas → Pagamentos → AR → Caixa/Conciliação | ✅ rotas e dashboards conectados |
| Compra → PO → Bill → AP → Pagamento fornecedor | ✅ `BillForm` + Payables + payments |
| Venda → Entrega/Pickup → Rota → Cliente | ✅ Routes + `/m5/pickups` + Delivery app |
| Venda → Produção → MO → Componentes → Stock | ✅ MO detail + planning + componentes |
| Produto → Variantes → BOM → MO → Compra/Reserva | ✅ BOM + SaleAvailabilityPanel |
| Danificado → Quarentena → Reparação → Stock/Sucata | ✅ F25-A integrado via `service_case_create_from_damaged_package` |
| Assistência → Peça → Compra/MO → Entrega | ✅ ServiceRepairsPage + release_to_stock |
| Helpdesk → Ticket → Service Case → Reparação/RMA | ✅ CustomerTicketDetail liga a service requests |
| Portal Cliente → Ticket/Mensagem → Helpdesk | ✅ token público + tokens admin |
| Chat → DM/Canal/Entidade → Dock global | ✅ unified (F24-C) |
| User → Store → Cash Register → Cash Session → Payment | ✅ F24-D1 + CTAs admin no RegisterPaymentDialog |
| Indicadores → Links para listas filtradas | ✅ IndicatorsPage |

---

## 5. Backlog (P2/P3, não implementar agora)

- **P1**: refator `Discuss.tsx` e `PickingScan.tsx` para RPCs (ver §3).
- **P2**: matriz granular de permissões por ação.
- **P2**: OEE / manutenção preventiva / scheduler visual (F25-B1).
- **P2**: integração bancária real (OFX/CSV/PSD2) para conciliação.
- **P2**: BI/dashboards cruzados (vendas × produção × stock).
- **P3**: IA/MCP, OCR de bills, app mobile entregador.

---

## 6. Saúde dos testes

```
Test Files  50 passed (50)
Tests       256 passed (256)
```

Cobertura nova nos blocos F24-C/D/D1 e F25-A/B mantida. Nenhuma regressão.
