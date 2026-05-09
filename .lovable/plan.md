## Objetivo

Permitir fluxos de saída em múltiplas etapas (Stock → Cais de Carga → Carrinha → Cliente) e agrupar pickings em **lotes (batch)** e **ondas (wave)** para separar material em massa, primeiro para o cais e depois para carregar a viatura.

---

## 1. Modelo de etapas por armazém

Hoje cada armazém faz `outgoing` direto: `Stock → Cliente`. Vamos suportar **3 modos** configuráveis em `warehouses`:

- **`one_step`** (atual): Stock → Cliente
- **`two_steps`**: Stock → **Cais de Carga** → Cliente (pick + ship)
- **`three_steps`**: Stock → **Cais de Carga** → **Zona Carrinha** → Cliente (pick + pack + ship)

E o equivalente para entradas (`incoming`): one/two/three steps usando *Receção* / *Controlo Qualidade* / *Stock*.

### Alterações de schema
- `warehouses`: novas colunas `delivery_steps text default 'one_step'` e `reception_steps text default 'one_step'`.
- Locações novas auto-criadas por armazém: `WH/Cais Carga` (output) e `WH/Zona Carrinha` (packing). Tipo `internal`.
- `stock_picking_types`: nova tabela leve para tipificar (ex. *Pick*, *Pack*, *Ship*) com `kind`, `default_source`, `default_dest`, `sequence_code`. Usada quando criamos a "cadeia" de pickings.

### Geração da cadeia
Quando uma SO é confirmada (ou um movimento de saída é criado) num armazém com `two/three_steps`:
- Em vez de **um** picking outgoing, criamos **N pickings encadeados** via `stock_pickings.backorder_id` reaproveitado como `previous_picking_id` (nova coluna explícita `previous_picking_id`).
- Cada picking só fica `ready` quando o anterior está `done` (trigger já existente `recalc_picking_state` adapta-se).
- A `origin` da SO propaga para todos os pickings da cadeia.

---

## 2. Batch Picking

Agrupar várias `stock_pickings` da **mesma etapa** (ex.: vários "Stock→Cais") para o operador separar tudo numa única passagem pelo armazém.

### Schema
```
stock_picking_batches
  id, name, state (draft|in_progress|done|cancelled),
  user_id (operador), created_at, scheduled_at, notes
```
- Em `stock_pickings`: nova coluna `batch_id uuid null`.
- RLS: mesma permissão de inventory.transfers.

### UI
- Nova página **/inventory/batches** (lista) e **/inventory/batches/:id** (detalhe).
- Botão "Criar batch a partir de selecionados" na lista de transferências (filtra `state in (ready, waiting)` e mesmo `kind`/etapa).
- Ecrã de batch mostra **agregação por produto** (qtd total a separar) + lista detalhada por picking de origem.
- Validar batch valida todos os pickings de uma vez (RPC `validate_batch(_batch uuid)`).

---

## 3. Wave Picking

Subconjunto do batch: agrupar **linhas de movimento** (não pickings inteiros) — útil para separar só uma SKU/zona em massa entre várias encomendas.

### Schema
```
stock_picking_waves
  id, name, state, user_id, created_at, notes
```
- Em `stock_moves`: nova coluna `wave_id uuid null`.
- Linhas de pickings diferentes podem partilhar a mesma wave.

### UI
- Página **/inventory/waves** + criação a partir de uma vista de "movimentos pendentes" filtrando por produto, categoria ou locação.
- Validar wave marca esses moves como `done` e atualiza estado de cada picking-pai (via `recalc_picking_state`).

---

## 4. UI — destaques

- Badge nova "Cais de Carga" / "Zona Carrinha" na listagem de transferências, derivada do par `source→dest`.
- No formulário de transferência mostrar o **fluxo encadeado** (breadcrumb visual): `Stock ▸ Cais ▸ Carrinha ▸ Cliente` com a etapa atual destacada.
- Banner "Aguarda etapa anterior (PICK/OUT/00012)" quando bloqueada.
- Na lista de batches: barra de progresso (X/Y pickings concluídos).
- Botão "Iniciar separação" no batch (atribui `user_id = auth.uid()`, marca `in_progress`).

---

## 5. Detalhes técnicos

**Migrações SQL**
1. `ALTER TABLE warehouses ADD COLUMN delivery_steps text DEFAULT 'one_step', ADD COLUMN reception_steps text DEFAULT 'one_step';` + check constraint.
2. Criar locações `Cais de Carga` e `Zona Carrinha` para cada warehouse existente (idempotente).
3. `ALTER TABLE stock_pickings ADD COLUMN previous_picking_id uuid REFERENCES stock_pickings(id), ADD COLUMN batch_id uuid;`
4. `ALTER TABLE stock_moves ADD COLUMN wave_id uuid;`
5. Tabelas `stock_picking_batches`, `stock_picking_waves` + RLS.
6. Função `create_outgoing_chain(_so uuid)` (substitui geração simples na `confirm_sale_order`); aplica `delivery_steps` do warehouse.
7. Atualizar trigger `recalc_picking_state` para esperar `previous_picking_id.state = 'done'` antes de promover a `ready`.
8. RPCs: `create_batch(_pickings uuid[])`, `validate_batch(_batch uuid)`, `create_wave(_moves uuid[])`, `validate_wave(_wave uuid)`.

**Frontend**
- `WarehouseForm`: dois selects "Etapas de saída" / "Etapas de entrada".
- Lista de transferências: coluna **Etapa**, filtro por etapa, checkbox de seleção, botão "Criar batch".
- Novas páginas em `src/modules/inventory/pages/`:
  - `BatchesList.tsx`, `BatchForm.tsx`
  - `WavesList.tsx`, `WaveForm.tsx`
- Atualizar `TransferForm.tsx` com banner da cadeia e link para batch/wave a que pertence.
- Registar rotas em `InventoryPages.tsx` e item de menu.

**Compatibilidade**
- Armazéns existentes ficam em `one_step` → nada muda no fluxo atual.
- SOs já confirmadas continuam com o picking único existente; só novas confirmações usam a cadeia.

---

## Fora deste plano
- Otimização de rota dentro do armazém (algoritmo de picking path).
- Impressão de etiquetas por bin do cais.
- Atribuição automática a operadores por carga de trabalho.
