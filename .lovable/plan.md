## Objetivo
Impedir que o total recebido de uma venda ultrapasse o valor da nota. O cliente nunca pode pagar a mais — nem por engano do utilizador, nem via Módulo do Entregador.

## Regras de negócio

1. **Por venda**: `Σ recebimentos válidos ≤ amount_total` (tolerância de 0,01 € para arredondamento).
2. **Por parcela** (quando `schedule_id` definido): `Σ recebimentos da parcela ≤ schedule.amount`.
3. Estados que contam para o limite: `posted`, `pending`, `pending_delivery` (qualquer recebimento não cancelado).
4. Cancelamento (`state = cancelled`) liberta o valor automaticamente.
5. Aplica-se a **todos os fluxos**: diálogo de recebimento, Reconciliação, Módulo do Entregador (RPC `driver_deliver_picking`), importações futuras.

## Implementação

### 1. Validação no servidor (fonte da verdade)

Trigger `BEFORE INSERT OR UPDATE` em `customer_payments` que:
- Calcula `em_aberto = sale_orders.amount_total - Σ outros pagamentos não cancelados` (exclui a própria linha em UPDATE).
- Se `NEW.state ≠ 'cancelled'` e `NEW.amount > em_aberto + 0.01` → `RAISE EXCEPTION` com mensagem clara em PT:
  `"Recebimento excede o valor em aberto da venda XYZ (em aberto: 120,00 €, tentativa: 150,00 €)"`.
- Mesma verificação por parcela quando `schedule_id` presente.

Vantagens: protege também `driver_deliver_picking`, edições diretas e qualquer integração futura.

### 2. UX no diálogo `RegisterPaymentDialog`

- Ao abrir, calcular e mostrar:
  - **Total da venda**, **Já recebido**, **Em aberto** (destacado).
- `defaultAmount` passa a ser `min(em_aberto, scheduleAmount)` em vez do total da parcela.
- Campo Valor com `max={em_aberto}` e validação client-side antes de gravar (toast: *"Valor excede o em aberto (X €)"*).
- Botão **"Pagar tudo"** que preenche com o em aberto exato.

### 3. UX no Módulo do Entregador (`DeliveryPicking`)

- Mostrar o em aberto da venda associada antes de cobrar.
- Limitar input do `payment_amount` ao em aberto.
- A RPC já será bloqueada pelo trigger; mas validamos antes para mensagem amigável no ecrã do motorista.

### 4. Reconciliação

- Como o trigger impede novos excessos, a categoria "Recebido a mais" passa a refletir apenas casos **legados**.
- Adicionar nota informativa no topo: *"Bloqueio ativo: novos recebimentos não podem exceder o valor da venda."*

## Detalhes técnicos

```sql
CREATE FUNCTION public.prevent_overpayment() RETURNS trigger AS $$
DECLARE
  v_total numeric;
  v_paid  numeric;
  v_open  numeric;
  v_name  text;
BEGIN
  IF NEW.state = 'cancelled' OR NEW.order_id IS NULL THEN RETURN NEW; END IF;

  SELECT amount_total, name INTO v_total, v_name
    FROM sale_orders WHERE id = NEW.order_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM customer_payments
   WHERE order_id = NEW.order_id
     AND state <> 'cancelled'
     AND id <> COALESCE(NEW.id, gen_random_uuid());

  v_open := v_total - v_paid;
  IF NEW.amount > v_open + 0.01 THEN
    RAISE EXCEPTION 'Recebimento excede o valor em aberto da venda % (em aberto: %, tentativa: %)',
      v_name, to_char(v_open,'FM999G990D00'), to_char(NEW.amount,'FM999G990D00');
  END IF;

  -- check por parcela
  IF NEW.schedule_id IS NOT NULL THEN
    -- (mesma lógica contra sale_payment_schedules.amount)
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

## Ficheiros afetados

- **Migration nova**: trigger `prevent_overpayment` em `customer_payments`.
- `src/modules/finance/components/RegisterPaymentDialog.tsx` — mostrar em aberto, cap no input, botão "Pagar tudo", validação.
- `src/modules/delivery/pages/DeliveryPicking.tsx` — mostrar em aberto e limitar input.
- `src/modules/finance/pages/ReconciliationPage.tsx` — banner informativo.

## Não faz parte (decisões a confirmar se quiseres)

- **Permitir adiantamentos** (cliente paga acima e fica como crédito): manter bloqueado sempre, ou abrir uma exceção via flag *"Aceitar adiantamento"* na venda?
- **Override por admin**: permitir que `system_admin` force um excesso (ex: arredondamento manual)?

Confirmas estas duas decisões antes de implementar?
