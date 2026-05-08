## Objetivo

Unificar o fluxo de pagamentos numa única experiência. Hoje existem duas etapas separadas — **Cronograma** (planear parcelas) e **Recebimentos** (registar dinheiro recebido) — o que confunde o utilizador. Vamos transformar tudo num **único processo: "Plano de Pagamento"** onde cada linha é, ao mesmo tempo, a parcela a receber **e** o local onde se confirma o recebimento.

## Como vai ficar (visão do utilizador)

Na tab "Pagamentos" da venda:

1. **Resumo no topo** — Total, Recebido, Em aberto, Próximo vencimento.
2. **Modelos rápidos** (visíveis quando ainda não há plano):
   - "100% na entrega" (default)
   - "50% sinal + 50% entrega"
   - "30% sinal + 70% entrega"
   - "2× (entrega + 30 dias)"
   - "3× (entrega + 30/60 dias)"
   - "Personalizado" (abre editor)
3. **Lista de parcelas** — cada parcela mostra: rótulo, vencimento, valor, estado (A receber / Parcial / Pago) e um botão único **"Receber"** ao lado.
   - Ao clicar **Receber** abre o diálogo já preenchido com o valor em aberto da parcela e o cliente. Confirmar marca a parcela como paga (ou parcial) automaticamente.
   - Cada parcela paga mostra inline o(s) recebimento(s) associado(s) (data, método, valor, referência) com opção de cancelar.
4. **Editar/adicionar parcela** — botão discreto "Editar plano" abre modo edição inline (sem o "modo avançado" separado). Adicionar/remover linhas, mudar valores/datas, salvar.

Removemos:
- A separação visual entre "Cronograma" e "Recebimentos".
- O toggle "Avançado" / "Simples".
- A tabela de "Recebimentos" no fundo (o histórico passa a viver dentro de cada parcela; mantemos um link discreto "ver todos os recebimentos desta venda" que expande).

## Mudanças técnicas

### Frontend (apenas `src/core/orders/PaymentsTab.tsx`)
- Reescrever o componente em torno de **uma única secção**: lista de parcelas (`sale_payment_schedules`) com ações inline.
- Botão **"Receber"** por linha → abre `RegisterPaymentDialog` passando `schedule_id`, `defaultAmount = amount - paid_amount`, `partnerId`.
- Após gravar pagamento, recarregar e expandir a linha mostrando o recebimento criado.
- Modo "Editar plano" substitui o toggle Avançado: mesmos presets, mesma tabela editável, mas dentro do mesmo card.
- Auto-criação: se não houver plano e o utilizador clicar "Receber" sem escolher modelo, criamos automaticamente uma única parcela "Total" com `due_kind=on_delivery` antes de abrir o diálogo.

### Backend
- **Sem migrations.** O schema já suporta tudo: `sale_payment_schedules` tem `paid_amount/state` e `customer_payments` tem `schedule_id`. Já existe (presumivelmente) um trigger que atualiza `paid_amount`/`state` da parcela quando se insere/cancela um `customer_payment` com `schedule_id`. Vou verificar e, se faltar, adicionar via migration separada — mas a UI nova já assume este comportamento.
- `RegisterPaymentDialog` passa a aceitar e gravar `schedule_id` (campo opcional novo no insert; já existe na tabela).

### Páginas relacionadas (sem alteração de comportamento, só consistência)
- `PaymentsPage.tsx` e `ReceivablesPage.tsx` continuam a funcionar — usam as mesmas tabelas. Sem mudanças nesta iteração.

## Fora de âmbito
- Não mexer em pagamentos a fornecedores nem em caixa.
- Não mudar o schema (a menos que o trigger de sincronização parcela↔pagamento esteja em falta — nesse caso, migration mínima).
