## Cadastro de Lojas (Pontos de Venda Físicos)

Adicionar uma entidade **Loja** ao sistema, com cadastro próprio, ligação a armazém/caixas/equipa, e usar como filtro em vendas e relatórios.

### 1. Base de dados (migration)

Nova tabela `stores`:
- Identificação: `code` (único), `name`, `active`
- Morada: `street`, `city`, `zip`, `country`, `phone`, `email`, `tax_id`
- Operação: `warehouse_id` (FK → `stock_warehouses`), `manager_id` (FK → `hr_employees`)
- Auditoria: `created_at`, `updated_at`

Tabela de junção `store_members`:
- `store_id`, `user_id`, `role` (manager/staff)
- PK composta (store_id, user_id)

Relação loja ↔ caixas: adicionar coluna `store_id` em `cash_registers` (nullable, FK).

Relação loja ↔ vendas: adicionar coluna `store_id` em `sales_orders` (nullable, FK) — usado apenas para filtragem/relatórios, sem regras automáticas.

RLS: padrão do sistema (`has_permission(..., 'core', 'stores', ...)`) — view aberta a autenticados, edit/create/delete via permissão. Adicionar entrada de permissão no módulo `core`.

### 2. Frontend

**Nova página** `src/modules/core/pages/StoresPage.tsx` em `/stores`:
- Listagem com colunas: Código, Nome, Cidade, Armazém, Gestor, Ativo
- Botão "Nova loja" → diálogo com campos de identificação, morada, seleção de armazém e gestor
- Edição inline ou diálogo, toggle ativo/inativo

**Diálogo de equipa** dentro da edição da loja:
- Listar membros (`store_members`), adicionar/remover utilizadores

**Navegação**: entrada "Lojas" no menu lateral em **Configurações** (ou Core), ícone Store.

**Integração mínima nas vendas** (`OrderForm`):
- Selector "Loja" (opcional) que grava `store_id` na ordem
- Filtro "Loja" na listagem de orders e nos relatórios financeiros

### 3. Out of scope (confirmado pelo utilizador)
- Sem segregação de stock por loja
- Sem restrição de utilizadores por loja (apenas informativo)
- Sem pricelist/horário por loja

### Ficheiros impactados
- **Criados**: migration `stores + store_members + colunas store_id`, `src/modules/core/pages/StoresPage.tsx`, `src/modules/core/components/StoreDialog.tsx`, `src/modules/core/components/StoreMembersDialog.tsx`
- **Editados**: `src/App.tsx` (rota `/stores`), sidebar, `src/core/orders/OrderForm.tsx` e listagem de orders (selector + filtro), relatórios financeiros (filtro por loja)
