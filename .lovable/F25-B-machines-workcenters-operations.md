# F25-B — Machines + Work Centers/Operations CRUD

Data: 2026-05-20

## 1. Auditoria

| Entidade | Campos atuais | Usado por | Risco | Ação |
|---|---|---|---|---|
| `work_centers` | code, name, type, warehouse_id, capacity_per_day, efficiency_percent, cost_per_hour, active, notes | `mo_operations`, `bom_lines`, `bom_operations`, `manufacturing_routing_operations`, `manufacturing_machines`, `manufacturing_bom_outputs`, `work_center_employees`, `mo_components`, `manufacturing_operations` | Médio (FK RESTRICT em `manufacturing_machines`) | Adicionar `archived_at/by/reason`. Arquivar bloqueia se há mo_ops ativas OU máquinas ativas associadas |
| `manufacturing_operations` | code, name, description, default_work_center_id, requires_machine/employee/quality_check, active | `mo_operations`, `bom_operations` (via `manufacturing_routing_operations`), `mo_components`, `operation_employee_skills` | Baixo (todos ON DELETE SET NULL/RESTRICT) | Adicionar `archived_at/by/reason`. Arquivar bloqueia se há mo_ops ativas |
| `manufacturing_machines` (já existia! ≠ `machines` solicitado) | code, name, work_center_id (NOT NULL, RESTRICT), status (enum: available/busy/maintenance/inactive), capacity_per_hour, cost_per_hour, active, notes, machine_type | `mo_operations.machine_id` | Médio | Estender com `maintenance_status`, `last_maintenance_at`, `next_maintenance_at`, `archived_at/by/reason`. Reusar tabela existente |
| `mo_operations` | machine_id, operation_id, work_center_id, state (pending/ready/in_progress/paused/done/blocked), ... | Shop floor, work order logs, QC, issues | Alto | **Não tocar**. Apenas leitura para validar uso |
| `bom_operations`, `manufacturing_routing_operations` | operation_id, work_center_id | BOM resolver | Alto | **Não tocar**. Não bloquear arquivamento por uso em BOM (apenas mo_ops ativas) |

**Desvio do plano:** O plano pediu tabela nova chamada `machines`. Como `manufacturing_machines` já existia com FK ativa em `mo_operations.machine_id` (com índice parcial em `state='in_progress'`), reusámos a tabela existente — criar uma nova causaria duplicação de domínio e quebraria a integração shopfloor. O enum `machine_status` não tem `archived`, por isso usamos `status='inactive'` no arquivamento (mantendo compatibilidade com o CHECK `machine_active_consistent`).

## 2. Migration aplicada

- `ALTER TABLE manufacturing_machines` adicionou: `maintenance_status` (CHECK ok/due/overdue/blocked), `last_maintenance_at`, `next_maintenance_at`, `archived_at/by/reason`.
- `ALTER TABLE work_centers`/`manufacturing_operations`: `archived_at/by/reason`.
- RPCs (SECURITY DEFINER, gate `mfg_can_manage`):
  - `machine_upsert(uuid, jsonb)`, `machine_archive(uuid, text)`
  - `work_center_upsert(uuid, jsonb)`, `work_center_archive(uuid, text)`
  - `manufacturing_operation_upsert(uuid, jsonb)`, `manufacturing_operation_archive(uuid, text)`
- Self-test: `_test_phase25_machines_workcenters_operations()` — 9/9 ✓.

## 3. Regras de validação

- `machine_upsert`: `code`/`name` obrigatórios, `work_center_id` obrigatório e ativo, `capacity_per_hour`/`cost_per_hour` ≥ 0, `code` único.
- `machine_archive`: motivo obrigatório, bloqueia se houver `mo_operations` ativas (`state IN pending|ready|in_progress|paused|blocked`) ligadas à máquina.
- `work_center_upsert`: `code`/`name` obrigatórios, `efficiency_percent > 0`, números ≥ 0, `code` único.
- `work_center_archive`: motivo obrigatório, bloqueia se há `mo_operations` ativas OU `manufacturing_machines.active=true` no centro.
- `manufacturing_operation_upsert`: `code`/`name` obrigatórios, work center default (se informado) deve estar ativo.
- `manufacturing_operation_archive`: motivo obrigatório, bloqueia se há `mo_operations` ativas com essa operação.

Sem delete físico. Sem bypass: tabelas escritas apenas via RPCs `SECURITY DEFINER`.

## 4. Frontend entregue

- `/manufacturing/machines` — `MachinesPage` (CRUD completo + filtros status/centro/manutenção/ativo).
- `/manufacturing/work-centers` — `WorkCentersPage` agora com criar/editar/arquivar.
- `/manufacturing/operations` — `OperationsPage` agora com criar/editar/arquivar.
- Dialogs: `MachineDialog`, `WorkCenterDialog`, `OperationDialog` (usando `useRpcMutation`).
- Menu Manufatura atualizado em `registry.ts` com link "Máquinas".

## 5. Zero-bypass

```
rg -n "from\\(['\"](machines|manufacturing_machines|work_centers|manufacturing_operations)['\"]\\)\\.(insert|update|upsert|delete)" src/modules src/core
→ ZERO_HITS ✓
```

## 6. Testes

- Backend: `SELECT * FROM _test_phase25_machines_workcenters_operations()` → 9/9 ✓
- Frontend: `F25B.machinesCrud.test.tsx` (4 testes) ✓
- Suite global: **256/256 verdes** ✓

## 7. Backlog F25-B1

- Manutenção preventiva automática (gerar tickets quando `next_maintenance_at` vence).
- OEE (Overall Equipment Effectiveness).
- Capacidade finita / scheduler visual (Gantt).
- Custos reais de máquina por sessão de produção.
- IoT / barcode check-in da máquina.
- Reorganizar enum `machine_status` para incluir `archived` explicitamente.
- Histórico de manutenção (`machine_maintenance_log`).
