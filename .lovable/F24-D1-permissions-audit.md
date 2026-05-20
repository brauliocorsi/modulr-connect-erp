# F24-D1 — Permissions & Store Assignments Audit

## Matriz

| Entidade | Existe? | UI? | Gap | Ação |
|---|---|---|---|---|
| `profiles` | sim | `/settings/users` (basic ListView) | sem visão de lojas/roles | reescrever com `OperationalDataTable` |
| `groups` | sim | `/settings/groups` | ok | nenhuma |
| `group_permissions` | sim | sem editor | fora de escopo D1 | backlog D1.1 |
| `user_groups` | sim | parcial em `CreateUserDialog` | falta editar pós-criação | novo `UserRolesPanel` |
| `user_store_assignments` | sim (id,user_id,store_id,role,is_default,active,created_by) | nenhuma | falta soft-delete + RPCs | + colunas `removed_*` + RPCs |
| `stores` | sim | `/settings/stores` | ok | nenhuma |
| `cash_registers` | sim (com store_id) | `/cashbox/registers` | ok | health-check |
| `cash_sessions` | sim | `/cashbox` | ok | health-check |
| `has_group` | sim | — | ok | reusar |
| `has_permission` | sim | — | ok | reusar |
| `current_user_store_ids` | sim | — | ok | reusar |

## Funções novas (F24-D1)

- `user_store_assignment_upsert(_user_id, _store_id, _role, _is_default, _active)`
- `user_store_assignment_remove(_assignment_id, _reason)` — soft delete (`active=false` + reason)
- `user_store_assignment_set_default(_assignment_id)`
- `user_role_assign(_user_id, _group_code)` — erro `group_not_found` se code inexistente
- `user_role_remove(_user_id, _group_code)`
- `permissions_health_check()` — read-only, agrega gaps P0/P1

Todas `SECURITY DEFINER SET search_path=public`, guard `has_group(auth.uid(),'system_admin')`.

## Health-check findings

| Código | Severity |
|---|---|
| `user_with_cash_permission_without_store` | P0 |
| `user_with_multiple_default_stores` | P0 |
| `cash_register_without_store` | P1 |
| `open_cash_session_register_without_store` | P1 |
| `user_store_assignment_inactive_but_open_session` | P0 |
| `cashier_without_cash_permission` | P1 |

## RLS

- `user_store_assignments`: políticas existentes mantidas (self-read + admin/finance write). Writes via RPC continuam funcionando; grants **não revogados** nesta fase (rollout seguro).
- `user_groups`, `groups`, `profiles`, `stores`, `cash_registers`, `cash_sessions`: sem mudanças.

## Backlog D1.1 (NÃO implementar agora)

- Editor granular de `group_permissions` (matriz módulo×entidade×ação).
- SCIM/SSO.
- Multiempresa profunda (escopo por `company_id`).
- Audit log de acessos (login/RLS deny).
- Sidebar permission-aware.
- Approval workflows para mudanças sensíveis.
