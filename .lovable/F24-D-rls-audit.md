# F24-D — Auditoria RLS e Permissões Operacionais

Data: 2026-05-20  
Resultado: **242/242 testes verdes**, self-test `_test_phase24_security_rls_permissions` 6/6 OK.

---

## 1. Tabelas hardened nesta fase (P0)

| Tabela | Antes | Depois | Writes diretos |
|--------|-------|--------|----------------|
| `conversation_threads` | `ALL USING(true) WITH CHECK(true)` | SELECT só participante/admin · writes só admin | bloqueado (RPC SECURITY DEFINER) |
| `conversation_messages` | `SELECT true` + `INSERT WITH CHECK true` | SELECT só participante/admin · writes só admin | bloqueado (RPC SECURITY DEFINER) |
| `conversation_participants` | `ALL USING(true)` | SELECT só própria participação / mesma thread / admin · writes só admin | bloqueado (RPC SECURITY DEFINER) |
| `conversation_attachments` | `ALL USING(true)` | SELECT via thread do user · writes só admin | bloqueado |
| `chat_messages` | `SELECT true` | SELECT só membros do canal ou canal público | INSERT mantém `author_id = auth.uid()` (Discuss legacy) |
| `chat_channel_members` | `SELECT true` | SELECT só própria/mesmo canal/admin/canal público | inalterado |
| `record_messages` | INSERT WITH CHECK `author_id = auth.uid()` | INSERT só admin direto; resto via `record_message_post` | direto bloqueado para users comuns |

Helper novo: `public.is_thread_participant(_thread, _user)` — SECURITY DEFINER STABLE.

---

## 2. Tabelas já corretas (não tocadas)

Auditadas e confirmadas com policies baseadas em `has_permission` / `has_group`:

- Finance: `customer_payments`, `cash_sessions`, `cash_movements`, `supplier_bills`, `supplier_bill_lines`, `supplier_payments`, `bank_reconciliation_batches`, `bank_reconciliation_lines`, `recurring_expenses`, `customer_credits`, `sale_payment_schedules`.
- Sales: `sale_orders`, `sale_order_lines` (has_permission).
- Compras: `purchase_orders`, `purchase_order_lines`.
- Produção: `manufacturing_orders`, `mo_components`, `mo_operations`.

Zero policies `USING(true)` ou `WITH CHECK(true)` no escopo financeiro (validado pelo self-test).

---

## 3. `USING(true)` remanescentes — classificação

Total: **70 → 64** após F24-D. Itens remanescentes classificados:

### 3.1 Aceitável (catálogos públicos / metadados internos)
`companies`, `stores`, `groups`, `group_permissions`, `user_groups`, `profiles_select`, `installed_modules`, `number_sequences`, `app_settings`, `payment_methods*`, `product_tags`, `product_tag_rel`, `product_woo_categories`, `woo_categories`, `product_package_templates`, `service_states`, `service_sla_policies`, `delivery_carriers`, `vehicles`, `delivery_region_rules`, `delivery_zip_rules`, `hr_employees`, `hr_departments` (SELECT).

**Risco:** baixo. São dimensões compartilhadas em todo o ERP — pôr ACL fina exigiria reescrever boa parte do app. Mantidas como leitura para `authenticated`.

### 3.2 Pendente para F24-D1 (gaps documentados, P1/P2)
- `record_messages` SELECT continua `true` — entity-level ACL exige mapa de permissão por record_type (sale_orders, service_cases, etc). Bloqueado o INSERT direto, leitura permanece authenticated. **Gap documentado.**
- `record_activities` SELECT `true` — mesmo motivo (chatter/audit timeline).
- `activity_events`, `module_events`, `notifications` (insert any auth), `notification_delivery_log` — telemetria interna; reescrever exige auditoria larga.
- `installed_modules im_write ALL true` — deve virar admin-only. **Ação recomendada F24-D1.**
- `purchase_order_origins poo_write ALL true` — idem.
- `erp_tasks et_select true`, `delivery_*_read true`, `loading_*_read`, `stock_packages_read`, `stock_package_movements`, `warehouse_bins/pallets`, `customer_pickups_read`, `dock_transfers_read`, `vehicle_route_manifest_read`, `package_damage_reports`, `service_sla_exceptions` — leitura ampla operacional; aceitável short-term, candidato a scoping por loja/armazém em F24-D1.

### 3.3 Crítico (bloqueado nesta fase)
Nenhum item P0 restante após F24-D.

---

## 4. Zero-bypass frontend

```
rg "from\(['\"](customer_payments|cash_movements|cash_sessions|supplier_bills|
    bank_reconciliation_lines|conversation_threads|conversation_messages|
    conversation_participants|record_messages|sale_orders|stock_moves|
    stock_quants|manufacturing_orders)['\"]\)\.(insert|update|upsert|delete)" src/
```

Resultado: **0 hits** nas tabelas no escopo P0 (chat unified + finance).

Hits remanescentes apenas em `src/modules/discuss/Discuss.tsx` para `chat_messages` / `chat_channels` / `chat_channel_members` (legacy) — coberto por bridge SECURITY DEFINER. Aceitável.

---

## 5. Regressões

- F17 payment_subcases: verdes.
- F20 financial_core: verdes.
- F24-B finance core: verdes.
- F24-B2 store cash: verdes.
- F24-C chat unified: verdes.
- Frontend: **242/242**.

---

## 6. Backlog F24-D1

1. UI de gestão de roles/permissões (`groups`, `group_permissions`).
2. `record_messages` / `record_activities` SELECT scoping por record_type + permissão.
3. `installed_modules`, `purchase_order_origins` writes → admin-only.
4. Audit log de acessos sensíveis (financeiro, chat).
5. Multiempresa profunda (company_id everywhere).
6. Permission-aware menu (esconder módulos sem `view`).
7. Realtime seguro com checks adicionais por canal.

---

## STOP RULE — nenhuma quebra detectada
Nenhuma policy precisou ser relaxada. Nenhum fluxo crítico afetado.
