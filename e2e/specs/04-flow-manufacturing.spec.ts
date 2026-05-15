import { test, expect } from "../lib/fixtures";

/**
 * Fluxo ERP completo (produto fabricado): BOM → venda → ordem produção →
 * reserva matéria-prima → chão de fábrica → conclusão → stock acabado →
 * entrega → pagamento → caixa → financeiro.
 */
test.describe.serial("Fluxo: produto fabricado", () => {
  test("1. lista de BOMs", async ({ audit, page }) => {
    await audit.goto("/products/bom");
    await expect(page.locator("body")).toContainText(/(bom|materiais)/i);
  });

  test("2. lista de ordens de fabricação", async ({ audit, page }) => {
    await audit.goto("/manufacturing/orders");
    await expect(page.locator("body")).toContainText(/(ordens|fabricação|manufatura)/i);
  });

  test("3. abrir diálogo de criação de MO manual", async ({ audit, page }) => {
    await audit.goto("/manufacturing/orders");
    await audit.probe({
      module: "Manufatura",
      route: "/manufacturing/orders",
      button: "Criar Ordem de Produção",
      locate: (p) => p.getByRole("button", { name: /(criar ordem|nov[oa]|criar)/i }),
      expectAfter: async (p) =>
        await expect(p.getByRole("dialog")).toBeVisible({ timeout: 10_000 }),
      suggestion:
        "Verificar enum mo_state (sem 'confirmed') e função mfg_create_manual_mo.",
    });
  });

  test("4. painel chão de fábrica", async ({ audit, page }) => {
    await audit.goto("/shop-floor");
    await expect(page.locator("body")).toContainText(/(pronto|produção|qualidade)/i);
  });

  test("5. controle de qualidade", async ({ audit, page }) => {
    await audit.goto("/shop-floor/quality");
    await expect(page.locator("body")).toContainText(/(qualidade|qc)/i);
  });

  test("6. entregas", async ({ audit, page }) => {
    await audit.goto("/delivery");
    await expect(page.locator("body")).toContainText(/entregas/i);
  });

  test("7. financeiro", async ({ audit, page }) => {
    await audit.goto("/finance");
    await expect(page.locator("body")).toContainText(/(financeiro|dashboard|receb)/i);
  });
});
