## Objetivo

Permitir identificar em que carrinha vai cada lote de entregas, dar ao entregador um módulo restrito para fechar a última etapa (entrega + cobrança do saldo), e gerir o caixa de cada motorista.

---

## 1. Base de dados (migration)

**Nova tabela `vehicles`**
- `name` (ex: "VAN-01"), `license_plate`, `driver_id` (uuid → auth.users), `cash_register_id` (uuid → cash_registers, opcional), `barcode` (único), `active`.
- RLS: leitura para utilizadores autenticados; gestão só para admin/inventory_manager.

**Extensões a tabelas existentes**
- `stock_picking_batches`: adicionar `vehicle_id uuid`, `driver_id uuid`, `delivery_date date`.
- `cash_registers`: adicionar `driver_id uuid` (caixa partilhado por motorista, mapeamento 1:1 ou 1:N).

**Novo grupo + permissões**
- Grupo `delivery_driver` (code).
- Permissão apenas para o módulo `delivery` (novo `app_module`).
- NÃO recebe os grupos default no `handle_new_user` quando criado como driver (gestão manual do admin).

**Função `driver_assign_batch(_batch, _vehicle, _driver)`**
- Atribui batch a carrinha/motorista, valida que o batch é só de pickings outgoing.

**Função `driver_deliver_picking(_picking, _payment_amount, _payment_method_id)`**
- Valida que o picking pertence a um batch atribuído ao motorista corrente (`auth.uid()`).
- Chama `validate_picking(_picking)`.
- Se `_payment_amount > 0`: cria `customer_payments` (state='posted') ligado à SO de origem, com `cash_register_id` da carrinha, e gera `cash_movements`.
- Trigger existente recalcula `payment_status` da SO.

---

## 2. Frontend — extensões existentes

**`/inventory/batches/:id` (BatchForm)**
- Selectores novos: Carrinha (vehicles) + Motorista + Data de entrega.
- Botão "Carregar na carrinha" → marca batch como `in_progress` e atribui.

**`/inventory/vehicles`** (CRUD novo)
- Lista + form (nome, matrícula, motorista, caixa, código de barras).
- Adicionar ao menu Inventory > Configuração.

**App Barcode existente (`/barcode/batches`)**
- Ao scanear código da carrinha → filtra batches dessa carrinha.

---

## 3. Novo módulo "Entregas" (`/delivery`)

Menu próprio no sidebar, visível apenas para `delivery_driver` (e admins). Layout simplificado, mobile-first.

```
/delivery                 → Home: lista batches do dia atribuídos ao motorista
/delivery/batch/:id       → Lista pickings do batch + estado (pendente/entregue)
/delivery/picking/:id     → Scan produtos → confirmar entrega → cobrar saldo
/delivery/cashbox         → Sessão de caixa do motorista (abrir/fechar/movimentos)
```

**Fluxo `/delivery/picking/:id`:**
1. Mostra cliente, morada, linhas do picking, saldo da SO em aberto.
2. Scan de cada produto (valida quantidades como no PickingScan).
3. Botão "Entregar e Cobrar" → modal com saldo em aberto + método de pagamento → chama `driver_deliver_picking`.
4. Feedback visual claro: ✅ entregue / 💰 cobrado / ❌ erro.

**Restrição de menu:** `useInstalledModules` / sidebar passa a esconder todos os módulos exceto `delivery` (e `discuss`) para utilizadores no grupo `delivery_driver`.

---

## 4. Componentes/ficheiros a criar

- `src/modules/delivery/` (novo módulo completo)
  - `pages/DeliveryHome.tsx`
  - `pages/DeliveryBatch.tsx`
  - `pages/DeliveryPicking.tsx`
  - `pages/DeliveryCashbox.tsx`
  - `DeliveryShell.tsx` (layout dedicado)
- `src/modules/inventory/pages/VehiclesList.tsx` + `VehicleForm.tsx`
- Editar: `BatchForm.tsx`, `App.tsx` (rotas), `core/modules/registry.ts` (novo módulo + entrada Vehicles), `AppShell` (filtragem por grupo).

---

## 5. Pontos técnicos

- Restrição de acesso do entregador: combina **grupo no DB** + **filtro no `MODULES` registry** baseado em `usePermissions().inGroup('delivery_driver')`.
- Caixa do motorista: ao abrir sessão, usa o `cash_register` ligado ao `driver_id = auth.uid()`. Movimentos de cobrança usam `kind='cash_in'` com referência à SO.
- Code de barras das carrinhas imprimível na folha de "Comandos" (já existente em `printBarcodes.ts`) — adiciono secção `printVehicleBarcodes()`.

---

## Ordem de execução

1. Migration (tabelas, grupo, funções, RLS).
2. CRUD de Vehicles + impressão de barcodes.
3. Atualização do BatchForm com atribuição.
4. Módulo `/delivery` completo + filtragem de menu.
5. Validação no preview.