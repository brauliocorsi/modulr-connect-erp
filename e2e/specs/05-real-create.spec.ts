import { test, expect } from "../lib/fixtures";
import { tag, E2E_PREFIX } from "../lib/test-data";

/**
 * Fluxos REAIS de criação via UI — clica botão, preenche formulário,
 * valida toast de sucesso, valida redireção para /:id, e valida persistência
 * relendo a página.
 *
 * Todos os registos usam prefixo TESTE_E2E_ — limpar com:
 *   DELETE FROM products WHERE name LIKE 'TESTE_E2E_%';
 *   DELETE FROM partners WHERE name LIKE 'TESTE_E2E_%';
 */

test.describe("Criação real via UI", () => {
  test("Produto · cria, salva, mostra toast e persiste", async ({ page, audit }) => {
    const name = tag("PROD");
    await audit.goto("/products");

    // Clica no Link "Novo" (Plus)
    await page
      .getByRole("link", { name: /(novo|criar|adicionar)/i })
      .or(page.getByRole("button", { name: /(novo|criar|adicionar)/i }))
      .first()
      .click();

    await expect(page).toHaveURL(/\/products\/new/i, { timeout: 10_000 });

    // Preenche nome (primeiro Input visível)
    await page.getByLabel(/nome do produto/i).fill(name);

    // Salvar
    const errBefore = test.info().attachments.length;
    await page.getByRole("button", { name: /^salvar$/i }).click();

    // Toast de sucesso
    await expect(page.getByText(/^salvo$/i)).toBeVisible({ timeout: 10_000 });

    // Redireção para /products/:uuid
    await expect(page).toHaveURL(
      /\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      { timeout: 10_000 },
    );

    // Persistência: volta para lista e procura
    await audit.goto("/products");
    await page.getByPlaceholder(/procurar|search/i).first().fill(E2E_PREFIX);
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });

    test.info().annotations.push({ type: "module", description: "Produtos" });
    test.info().annotations.push({ type: "button", description: "Salvar (criar)" });
    test.info().annotations.push({ type: "route", description: "/products/new" });
  });

  test("Cliente · cria via /sales/customers/new", async ({ page, audit }) => {
    const name = tag("CLI");
    await audit.goto("/sales/customers/new");

    // O formulário de partner usa um Input de Nome
    const nameInput = page.getByLabel(/^nome$/i).or(page.getByPlaceholder(/^nome$/i)).first();
    await nameInput.fill(name);

    await page.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/^salvo$/i)).toBeVisible({ timeout: 10_000 });

    test.info().annotations.push({ type: "module", description: "Vendas" });
    test.info().annotations.push({ type: "button", description: "Salvar cliente" });
    test.info().annotations.push({ type: "route", description: "/sales/customers/new" });
  });

  test("Fornecedor · cria via /purchase/suppliers/new", async ({ page, audit }) => {
    const name = tag("FORN");
    await audit.goto("/purchase/suppliers/new");
    const nameInput = page.getByLabel(/^nome$/i).or(page.getByPlaceholder(/^nome$/i)).first();
    await nameInput.fill(name);
    await page.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/^salvo$/i)).toBeVisible({ timeout: 10_000 });

    test.info().annotations.push({ type: "module", description: "Compras" });
    test.info().annotations.push({ type: "button", description: "Salvar fornecedor" });
    test.info().annotations.push({ type: "route", description: "/purchase/suppliers/new" });
  });
});
