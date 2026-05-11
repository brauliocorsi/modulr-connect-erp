## Objetivo

Hoje, uma venda (ex.: SO00004) gera 3 pickings físicos: WH/OUT/00008, 00009, 00010 — cada um aparece como linha separada nas Transferências e como N movimentos soltos em Movimentos de Stock. Isto polui a UI.

A cadeia física continua a existir (necessária para rastreio), mas a interface passa a apresentá-la **agrupada por origem (SO/PO/transferência interna)** numa única linha-mestre expansível com as etapas dentro.

## Mudanças (apenas frontend, sem alterar schema nem fluxo)

### 1. `src/modules/inventory/pages/TransfersList.tsx`
- Após carregar os pickings (com os filtros já existentes), agrupar pelo campo `origin` (`SO00004`, `PO00002`, etc.). Pickings sem `origin` ficam como linhas individuais (comportamento atual).
- Render em duas formas, com toggle "Agrupar por origem" (default ON, persistido em `user_filter_preferences` com a chave `transfers-group-by-origin`):
  - **Linha-mestre** por origem: mostra origem, parceiro, nº de etapas, estado consolidado (ver regra abaixo), data programada mais cedo, data feita mais tarde.
  - Click expande mostrando as etapas (sub-linhas indentadas) ordenadas pelo fluxo físico (source→destination encadeado), cada uma com o seu nome (`WH/OUT/00008`…), estado individual e link para o detalhe.
- **Estado consolidado** (espelha o que o utilizador já vê hoje em "ordem"):
  - `cancelled` se todos cancelados
  - `done` se todos done
  - `ready` se a primeira etapa pendente está ready
  - `waiting` caso contrário
  - badge mostra também "Etapa X de Y" para dar contexto
- Ordenação interna das etapas por dependência: a etapa cujo `source_location_id` não é destino de nenhuma outra etapa do grupo é a primeira; as seguintes encadeiam por `destination_location_id == próxima.source_location_id`. Fallback: ordenar por `created_at`.
- Filtro de estado existente passa a aplicar-se ao **estado consolidado** quando o agrupamento está ativo (filtrar "Pronto" mostra grupos cuja próxima etapa pendente está pronta — exatamente o que o utilizador pediu antes).

### 2. `src/modules/inventory/pages/MovesPage.tsx`
- Mesmo padrão: agrupar movimentos por `stock_pickings.origin`. Linha-mestre por SO/PO, expansível mostrando os movimentos individuais (com produto/variante, quantidade, etapa).
- Toggle "Agrupar por origem" (default ON, mesma persistência por utilizador).
- Quando o filtro Produto está ativo, o grupo só aparece se contiver pelo menos um movimento desse produto, e ao expandir só lista os movimentos relevantes.

### 3. `src/modules/inventory/pages/InternalTransfersPage.tsx`
- Mesmo agrupamento opcional para transferências internas que partilhem `origin` (raras hoje, mas consistente).

### 4. Detalhe do picking (`TransferForm.tsx`)
- No topo, quando o picking pertence a uma cadeia (existem outros pickings com o mesmo `origin`), mostrar uma faixa "Cadeia da venda SO00004" com os passos clicáveis em ordem e um indicador "Esta etapa: X de Y". Já existe algo parecido (passos 1/2/3) — apenas garantir que reaproveita esta lógica de ordenação por dependência e fica consistente com a lista.

## Diagrama do agrupamento

```text
Antes (lista plana):
  WH/OUT/00008  Pronto       SO00004
  WH/OUT/00009  A aguardar   SO00004
  WH/OUT/00010  A aguardar   SO00004

Depois (agrupado, expandível):
  ▸ SO00004  Cliente X  Pronto · Etapa 1 de 3   3 etapas
       └─ WH/OUT/00008  Stock → Cais        Pronto
       └─ WH/OUT/00009  Cais → Carrinha     A aguardar
       └─ WH/OUT/00010  Carrinha → Cliente  A aguardar
```

## O que NÃO muda

- Schema da BD, triggers, funções RPC, fluxo de validação, reservas, backorders.
- Rotas e detalhe de cada picking — continuam acessíveis individualmente.
- Impressão de picking, scan, waves.

## Verificação

1. SO00004 aparece como **uma linha** em Transferências e em Movimentos.
2. Filtro "Pronto" mostra a SO00004 (porque a próxima etapa pendente é Pronta).
3. Expandir mostra as 3 etapas na ordem física Stock → Cais → Carrinha → Cliente.
4. Validar a etapa Pronta avança a cadeia e o estado consolidado da linha-mestre passa a "Etapa 2 de 3 · Pronto" (ou "A aguardar" se ainda não houver stock).
5. Toggle "Agrupar" desligado volta ao comportamento atual.
6. Preferência de agrupamento persiste por utilizador (entre dispositivos).
