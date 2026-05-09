## Melhorias no módulo de Compras

### 1. Receção automática + parcial com backorder
- Trigger no `stock_pickings`: quando uma receção (`kind='incoming'`) cuja `origin` corresponde a um PO passa a `state='done'`, marcar o PO como `done` (mesmo se for parcial — a função `validate_picking` já cria automaticamente a backorder com os itens em falta).
- Manter o registo de quanto foi recebido por linha do PO (calculado via soma dos `stock_moves.quantity_done` agrupados por produto e `origin`).

### 2. Quem pediu e quando
- Garantir que ao criar um PO se gravam `created_by = auth.uid()`, `buyer_id = auth.uid()` (se vazio) e `created_at`.
- Mostrar nome do comprador e data/hora na lista e detalhes.

### 3. Lista de PO com expandir e rastreio de vendas
Substituir o `ListView` genérico por uma lista própria com:
- Linha principal: Número, Fornecedor, Comprador, Data, Estado, Total, Vendas de origem (badges).
- Botão de expansão (chevron) que mostra:
  - Tabela das **linhas de produto** (produto, qtd pedida, qtd recebida, qtd em falta, preço, subtotal).
  - Lista das **encomendas de venda de origem** com link para `/sales/orders/:id`.
  - Lista de **receções relacionadas** com estado.
- Filtros rápidos por estado (Rascunho, Enviado, Confirmado, Concluído).

### 4. Origens múltiplas (vendas → 1 compra)
Hoje `purchase_orders.origin` é um único `text` (nome da SO). Para suportar agrupamento, criar:

```text
purchase_order_origins
  po_id  uuid → purchase_orders.id (cascade)
  sale_order_id uuid → sale_orders.id
  PRIMARY KEY (po_id, sale_order_id)
```

- Backfill: para cada PO existente cujo `origin` corresponde a uma SO, inserir a relação.
- Atualizar `confirm_sale_order` para inserir também na nova tabela quando criar/reaproveitar o PO automático.
- Ajustar `tg_recalc_from_po` para usar a nova tabela (suporta múltiplas SOs).

### 5. Agrupamento de pedidos por fornecedor
Funciona de duas formas:

**Automático** (já existe parcialmente):
- `confirm_sale_order` continua a procurar PO em `draft` do mesmo fornecedor + armazém. Mudança: deixa de filtrar por `origin = o.name` (hoje cria um por SO). Passa a juntar qualquer rascunho do mesmo fornecedor/armazém e regista a SO em `purchase_order_origins`.

**Manual**:
- Botão **"Agrupar selecionados"** na lista de PO, ativo só quando todos os selecionados são `draft`, do mesmo fornecedor e armazém.
- Função RPC `merge_purchase_orders(_target uuid, _sources uuid[])`:
  - Move/Funde linhas (mesmo produto + preço → soma quantidades; senão acrescenta linha).
  - Copia origens das SOs para o destino.
  - Recalcula `amount_*`.
  - Cancela e apaga os POs de origem.
- Ação só aparece enquanto o PO ainda não foi enviado a fornecedor (`state='draft'`).

### 6. UI — destaques
- Badge cinza "Rascunho", azul "Enviado", âmbar "Confirmado", verde "Concluído".
- Coluna "Vendas" mostra até 3 chips com nº da SO; tooltip com lista completa.
- Linhas expansíveis com animação suave; persistir o estado expandido na sessão.
- Checkbox de seleção por linha + barra de ações (Agrupar, Cancelar).

---

### Detalhes técnicos

**Migrações SQL**
- Criar tabela `purchase_order_origins` + RLS (qualquer authenticated lê; insert/update/delete a quem tem permissão `purchase.orders.edit`).
- Trigger `tg_po_done_on_receipt` em `stock_pickings AFTER UPDATE` que faz:
  ```sql
  UPDATE purchase_orders SET state='done'
  WHERE name = NEW.origin AND state IN ('confirmed','rfq_sent') AND NEW.kind='incoming' AND NEW.state='done';
  ```
- Função `merge_purchase_orders(_target uuid, _sources uuid[])` SECURITY DEFINER.
- Atualizar `confirm_sale_order` para procurar PO em rascunho **sem** filtro de origin e popular `purchase_order_origins`.
- Backfill da nova tabela a partir do `origin` existente.

**Frontend**
- Nova página `src/modules/purchase/pages/PurchaseOrdersList.tsx` (substitui o export atual no `PurchasePages.tsx`).
- Hook auxiliar para carregar lines + receipts + origins por PO sob demanda ao expandir.
- Reutilizar `PageHeader`, `Badge`, `Table`, `Checkbox` shadcn.
- No `OrderForm` (kind="purchase") garantir defaults `created_by`/`buyer_id = auth.uid()`.

**Sem alterações** em: rotas, `RfqKanban`, `OrderForm` estrutura geral.