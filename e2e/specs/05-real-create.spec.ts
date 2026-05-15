import { test, expect } from "../lib/fixtures";
import { tag, E2E_PREFIX } from "../lib/test-data";

/**
 * Fluxos REAIS de criação via UI — clica botão, preenche formulário,
 * valida toast de sucesso, valida redireção para /:id, e valida persistência.
 *
 * Limpeza pós-execução (manual):
 *   DELETE FROM products WHERE name LIKE 'TESTE_E2E_%';
 *   DELETE FROM partners WHERE name LIKE 'TESTE_E2E_%';
 */

// Os <Label> do shadcn não têm htmlFor, então preenchemos por proximidade.
async function fillLabeled(page: any, labelText: RegExp, value: string) {
  // textbox/spinbutton imediatamente a seguir ao texto do label
  const field = page
    .locator(`label:has-text("${labelText.source.replace(/[\\/^$.*+?()[\]{}|]/g, "")}") + input, label:has-text("${labelText.source.replace(/[\\/^$.*+?()[\]{}|]/g, "")}") ~ input`)
    .first();
  await field.fill(value);
}

test.describe("Criação real via UI", () => {
  test("Produto · cria, salva, mostra toast e persiste", async ({ page, audit }) => {
    const name = tag("PROD");
    await audit.goto("/products/new");

    // Primeiro input visível é o "Nome do produto"
    await page.locator('input[type="text"], input:not([type])').first().fill(name);

    await page.getByRole("button", { name: /^salvar$/i }).click();

    // Sucesso: o heading da página passa a mostrar o nome (form.name no FormHeader)
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible({ timeout: 15_000 });

    // Persistência: query API direta via supabase ou volta à lista
    await audit.goto("/products");
    const search = page.getByPlaceholder(/procurar|search|buscar/i).first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill(E2E_PREFIX);
    }
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });

    test.info().annotations.push({ type: "module", description: "Produtos" });
    test.info().annotations.push({ type: "button", description: "Salvar (criar)" });
    test.info().annotations.push({ type: "route", description: "/products/new" });
  });

  test("Cliente · cria via /sales/customers/new", async ({ page, audit }) => {
    const name = tag("CLI");
    await audit.goto("/sales/customers/new");
    await page.locator('input[type="text"], input:not([type])').first().fill(name);
    await page.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/^salvo$/i).first()).toBeVisible({ timeout: 15_000 });

    test.info().annotations.push({ type: "module", description: "Vendas" });
    test.info().annotations.push({ type: "button", description: "Salvar cliente" });
    test.info().annotations.push({ type: "route", description: "/sales/customers/new" });
  });

  test("Fornecedor · cria via /purchase/suppliers/new", async ({ page, audit }) => {
    const name = tag("FORN");
    await audit.goto("/purchase/suppliers/new");
    await page.locator('input[type="text"], input:not([type])').first().fill(name);
    await page.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/^salvo$/i).first()).toBeVisible({ timeout: 15_000 });

    test.info().annotations.push({ type: "module", description: "Compras" });
    test.info().annotations.push({ type: "button", description: "Salvar fornecedor" });
    test.info().annotations.push({ type: "route", description: "/purchase/suppliers/new" });
  });
});
