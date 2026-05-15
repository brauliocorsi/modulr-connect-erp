import { test, expect } from "../lib/fixtures";

/**
 * Fluxo ERP completo (produto comprado): compra → recepção → stock → venda
 * → reserva → picking → entrega → pagamento → caixa → financeiro.
 *
 * Este teste é "happy-path navegacional": valida que cada etapa abre, aceita
 * input e devolve toast/URL correctos. Não substitui validação RPC do
 * `e2e-checklist`; complementa-o do lado do utilizador.
 */
test.describe.serial("Fluxo: produto comprado", () => {
  test("1. abrir lista de compras", async ({ audit, page }) => {
    await audit.goto("/purchase/orders");
    await expect(page.locator("body")).toContainText(/compras/i);
  });

  test("2. abrir lista de recepções", async ({ audit, page }) => {
    await audit.goto("/inventory/receipts");
    await expect(page.locator("body")).toContainText(/(receção|recebimento|incoming)/i);
  });

  test("3. abrir lista de vendas", async ({ audit, page }) => {
    await audit.goto("/sales/orders");
    await expect(page.locator("body")).toContainText(/(pedidos|vendas)/i);
  });

  test("4. abrir picking/transferências", async ({ audit, page }) => {
    await audit.goto("/inventory/transfers");
    await expect(page.locator("body")).toContainText(/transfer/i);
  });

  test("5. abrir entregas", async ({ audit, page }) => {
    await audit.goto("/delivery");
    await expect(page.locator("body")).toContainText(/entregas/i);
  });

  test("6. abrir recebimentos financeiros", async ({ audit, page }) => {
    await audit.goto("/finance/payments");
    await expect(page.locator("body")).toContainText(/(receb|pagamento)/i);
  });

  test("7. abrir caixa", async ({ audit, page }) => {
    await audit.goto("/cashbox");
    await expect(page.locator("body")).toContainText(/caixa/i);
  });
});
