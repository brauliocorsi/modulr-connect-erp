# Caixa do entregador no app Caixa

Hoje, em **Caixa → Caixas → Novo Caixa**, só se cria caixa de **loja** (obriga a escolher loja). O app de entregador (`DeliveryCashbox`) já procura `cash_registers.driver_id = user.id`, mas não há UI para criar esse caixa — daí a mensagem "Não tens caixa associado".

## Objetivo

No diálogo "Novo Caixa", permitir escolher o **tipo** de caixa:
- **Loja** (atual) — exige loja
- **Entregador** (novo) — exige departamento + entregador responsável (driver)

## Mudanças

### 1. Base de dados (migração)
- Adicionar coluna `department_id uuid` em `cash_registers` (nullable, referência lógica a `hr_departments.id`).
- Manter `driver_id` (já existe) e `user_id` (responsável). Para caixa de entregador, `driver_id = user_id` (mesmo utilizador).
- `store_id` e `warehouse_id` passam a ser nullable na lógica do form quando o tipo é "Entregador".

### 2. `CashRegistersList.tsx` — diálogo "Novo Caixa"
- Novo seletor no topo: **Tipo de caixa** → `loja | entregador` (default `loja`).
- Quando **entregador**:
  - Esconder campos Loja / Armazém / Diário (cria diário automaticamente).
  - Mostrar **Departamento** (select de `hr_departments`, opcional).
  - **Responsável (Entregador)**: select de `hr_employees` filtrado pelo departamento escolhido (mostra apenas empregados com `user_id` definido). Se não houver departamento selecionado, lista todos.
  - Ao gravar: `driver_id = user_id` do empregado, `department_id` = escolhido, `store_id/warehouse_id = null`, criar diário `CASH-DRV-{nome}` automaticamente.
  - Nome sugerido: pré-preencher como `Caixa <nome do entregador>` quando se escolhe responsável.
- Quando **loja**: comportamento atual inalterado.

### 3. Listagem de caixas (mesmo ficheiro)
- No card mostrar badge "Entregador" quando `driver_id` definido (em vez de "Loja: —").
- Mostrar nome do departamento quando aplicável.

## Detalhes técnicos

- `cash_registers` SELECT já permite `inventory_user`/`sales_user`; INSERT continua via política `cash_registers_manage` (precisa permissão `finance.cash_registers.edit`).
- `DeliveryCashbox` não precisa de alterações — assim que existir um registo com o `driver_id` certo, passa a aparecer ao entregador.
- Diário criado automaticamente reutiliza o padrão já existente (`account_journals` type `cash`).

## Ficheiros afetados

- Migração SQL: `ALTER TABLE cash_registers ADD COLUMN department_id uuid;`
- `src/modules/cashbox/pages/CashRegistersList.tsx` (diálogo + listagem)
