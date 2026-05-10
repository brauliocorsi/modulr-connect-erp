
# Fluxo Stock → Cais → Carrinha → Cliente

## Objetivo

Modelar o fluxo de saída completo, suportando:
- Entrega normal em **3 passos** (Stock → Cais → Carrinha → Cliente)
- **Levantamento** pelo cliente (apenas Cais → Cliente, salta Carrinha)
- **Reagendamento** quando o cliente falta no cais ou na entrega (produto volta para Stock mas continua reservado)
- **Cancelamento** que liberta o stock e realoca a outro cliente em espera (data mais antiga primeiro), notificando os utilizadores
- Atribuição de **carrinha própria ou transportadora terceirizada** com visibilidade clara em cada passo

---

## 1. Modo de entrega ao confirmar a venda

Adicionar campo `delivery_mode` à `sale_orders` com 3 opções:

| Modo | Cadeia gerada |
|---|---|
| `delivery` (default) | Stock → Cais → Carrinha → Cliente (3 passos) |
| `pickup` (levantamento) | Stock → Cais → Cliente (2 passos, sem Carrinha) |
| `direct` | Stock → Cliente (1 passo, mantém comportamento atual) |

Na tela da venda, o vendedor escolhe o modo; o `confirm_sale_order` decide a cadeia em vez de depender só de `warehouses.delivery_steps`.

---

## 2. Reagendamento (cliente não veio buscar / não estava em casa)

Novo botão **"Reagendar"** disponível no picking quando o produto já saiu do Stock mas a entrega/levantamento falhou (estado `ready`, localização atual = Cais ou Carrinha).

Comportamento:
1. Cria um picking de retorno automático: localização atual → Stock, marcado com `is_reschedule=true`.
2. Validação imediata desse retorno (move o stock fisicamente de volta).
3. **Mantém** os movimentos da venda original com `state='waiting'` e a quantidade **continua reservada** em Stock (não fica disponível para outros clientes).
4. Pede ao utilizador uma nova `scheduled_at` e uma `reschedule_reason` (motivo).
5. Picking ganha flag visual **"Reagendado"** + contador `reschedule_count`.
6. Notifica vendedor + motorista da nova data.

A reserva permanece porque o pedido continua válido — só "voltou para o armazém à espera de novo agendamento".

---

## 3. Cancelamento → realocação por antiguidade

Já existe `cancel_picking` + `reallocate_freed_stock`. A acrescentar:
- Garantir que a realocação **prioriza vendas com `date_order` mais antiga** que estão à espera de stock.
- Após realocar, **notificar o vendedor da SO destinatária** ("Stock disponibilizado para a venda SO/00045 a partir do cancelamento de SO/00012").
- Notificar também o vendedor da SO cancelada com o resumo do que foi libertado.

---

## 4. Carrinha / Transportadora

### Localização "Em Entrega"
Renomear a zona `Zona Carrinha` para **"Em Entrega"** (uma única localização interna, conforme escolhido).

### Tabela nova: `delivery_carriers`
Transportadoras terceirizadas (Chronopost, CTT, etc.) com nome, contacto, ref. de tracking opcional.

### Campos novos em `stock_pickings` (apenas na etapa "Em Entrega" e "Cliente")
- `vehicle_id` — carrinha própria (FK `vehicles`)
- `carrier_id` — transportadora externa (FK `delivery_carriers`)
- `tracking_ref` — código de seguimento da transportadora
- exatamente um de `vehicle_id`/`carrier_id` deve estar preenchido antes de validar a saída do Cais

### UX
No passo **"Pack (Cais → Em Entrega)"** o utilizador escolhe:
- ☐ Carrinha própria → seleciona viatura + motorista
- ☐ Transportadora externa → seleciona transportadora + introduz tracking

Essa info propaga-se para o picking seguinte (Em Entrega → Cliente) e fica visível em todas as listas (`TransfersList`, `ShipmentsPage`, detalhe da venda).

---

## 5. Visibilidade do fluxo

### `TransferForm` (detalhe do picking)
Adicionar **stepper** no topo a mostrar a cadeia completa da venda:
```
[✓] Pick (Stock→Cais)  →  [●] Pack (Cais→Carrinha)  →  [ ] Ship (Carrinha→Cliente)
```
Cada passo mostra: estado, data, responsável, viatura/transportadora se aplicável.

### Etiquetas de estado já existentes
Reutilizar `stateLabel` ("Pronto"/"Realizado") e adicionar badges:
- 🔄 **Reagendado** (quando `reschedule_count > 0`)
- 🚚 nome da carrinha **ou** 📦 nome da transportadora
- 🛒 **Levantamento** (quando `delivery_mode='pickup'`)

---

## Detalhes técnicos

### Migrações
1. `ALTER TABLE sale_orders ADD COLUMN delivery_mode text DEFAULT 'delivery' CHECK (delivery_mode IN ('delivery','pickup','direct'))`
2. `ALTER TABLE stock_pickings ADD COLUMN vehicle_id uuid REFERENCES vehicles, ADD COLUMN carrier_id uuid REFERENCES delivery_carriers, ADD COLUMN tracking_ref text, ADD COLUMN reschedule_count int DEFAULT 0, ADD COLUMN reschedule_reason text, ADD COLUMN is_reschedule boolean DEFAULT false`
3. `CREATE TABLE delivery_carriers (id, name, contact, tracking_url_template, active, ...)` + RLS
4. `UPDATE stock_locations SET name='Em Entrega' WHERE name='Zona Carrinha'` (mantém id para não quebrar dados)
5. Reescrever `create_outgoing_chain(_order)` para receber `delivery_mode` da SO em vez de `warehouses.delivery_steps`.
6. Nova função `reschedule_picking(_picking, _new_date, _reason)`:
   - Cria picking de retorno (loc atual → Stock), valida-o.
   - Repõe o picking original em `waiting`, mantém `reserved_quantity`.
   - Incrementa `reschedule_count`, guarda `reschedule_reason`, atualiza `scheduled_at`.
7. Ajustar `reallocate_freed_stock` para `ORDER BY sale_orders.date_order ASC` e notificar os vendedores envolvidos.
8. Ajustar `tg_chain_advance_on_done` para não avançar se `is_reschedule=true`.

### Frontend
- `src/modules/sales/...` — selector de `delivery_mode` no formulário da venda.
- `src/modules/inventory/pages/TransferForm.tsx` — stepper, botão **Reagendar** com diálogo (data + motivo), seletor de viatura/transportadora no passo Pack.
- `src/modules/inventory/pages/TransfersList.tsx` + `ShipmentsPage.tsx` — colunas viatura/transportadora + badge reagendado.
- Nova página simples `src/modules/inventory/pages/CarriersList.tsx` para CRUD de transportadoras.
- Notificações já usam `notify_user`, basta acrescentar as novas chamadas no SQL.

### Comportamento esperado
- Confirmar venda em `pickup` → cria 2 pickings: Stock→Cais e Cais→Cliente. O segundo só fica `ready` quando o cliente vier (validado manualmente no balcão).
- Confirmar venda em `delivery` → 3 pickings encadeados; o passo "Em Entrega" exige viatura ou transportadora.
- "Reagendar" no Cais → produto volta a Stock reservado, picking marcado 🔄.
- Cancelar venda → stock libertado é oferecido ao SO mais antigo em espera, notificando vendedor.
