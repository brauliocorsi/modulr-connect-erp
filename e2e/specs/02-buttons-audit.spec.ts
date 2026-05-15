import { test, expect, Page } from "../lib/fixtures";

/**
 * Auditoria botão-a-botão. Os botões "Novo/Criar" do ListView são `<Link>`
 * estilizados — então procuramos por role link OU button com o mesmo nome.
 */
const createBtn = (re: RegExp) => (p: Page) =>
  p.getByRole("link", { name: re }).or(p.getByRole("button", { name: re }));

const NEW_RE = /(novo|nova|criar|adicionar|\+\s*$)/i;

test.describe("Botões críticos — Produtos", () => {
  test('Produtos · "Novo"', async ({ page, audit }) => {
    await audit.goto("/products");
    await audit.probe({
      module: "Produtos",
      route: "/products",
      button: "Novo",
      locate: createBtn(NEW_RE),
      expectAfter: async (p) =>
        await expect(p).toHaveURL(/\/products\/(new|[a-f0-9-]{8,})/i, { timeout: 10_000 }),
    });
  });

  test('Produtos · "BOM"', async ({ audit, page }) => {
    await audit.goto("/products/bom");
    await audit.probe({
      module: "Produtos",
      route: "/products/bom",
      button: "Novo BOM",
      locate: createBtn(NEW_RE),
      expectAfter: async (p) =>
        await expect(p).toHaveURL(/\/products\/bom\/(new|[a-f0-9-]{8,})/i, { timeout: 10_000 }),
    });
  });
});

test.describe("Botões críticos — Inventário", () => {
  test("Receitas · listagem", async ({ audit, page }) => {
    await audit.goto("/inventory/receipts");
    test.info().annotations.push({ type: "module", description: "Inventário" });
    test.info().annotations.push({ type: "route", description: "/inventory/receipts" });
    test.info().annotations.push({ type: "button", description: "(página)" });
    await expect(page.locator("body")).toContainText(/(rece[çc][ãa]o|entrada|stock)/i);
  });

  test("Transferências · listagem", async ({ audit, page }) => {
    await audit.goto("/inventory/transfers");
    test.info().annotations.push({ type: "module", description: "Inventário" });
    test.info().annotations.push({ type: "route", description: "/inventory/transfers" });
    test.info().annotations.push({ type: "button", description: "Criar lote (selecionar)" });
    await expect(page.getByRole("button", { name: /criar lote/i })).toBeVisible({ timeout: 10_000 });
  });

  test("Ajustes · listagem", async ({ audit, page }) => {
    await audit.goto("/inventory/adjustments");
    test.info().annotations.push({ type: "module", description: "Inventário" });
    test.info().annotations.push({ type: "route", description: "/inventory/adjustments" });
    test.info().annotations.push({ type: "button", description: "(página)" });
    await expect(page.locator("body")).toContainText(/(ajuste|invent[áa]rio)/i);
  });
});

test.describe("Botões críticos — Barcode", () => {
  for (const op of [
    { label: "Receção", route: "/barcode/op/incoming" },
    { label: "Expedição", route: "/barcode/op/outgoing" },
    { label: "Transferência", route: "/barcode/op/internal" },
  ]) {
    test(`Barcode · ${op.label} carrega scanner`, async ({ audit, page }) => {
      await audit.goto(op.route);
      test.info().annotations.push({ type: "module", description: "Barcode" });
      test.info().annotations.push({ type: "route", description: op.route });
      test.info().annotations.push({ type: "button", description: `Scanner ${op.label}` });
      await expect(page.locator("body")).toContainText(/(scan|c[óo]digo|opera[çc][ãa]o)/i);
    });
  }
});

test.describe("Botões críticos — Vendas", () => {
  test("Vendas · Novo pedido", async ({ audit, page }) => {
    await audit.goto("/sales/orders");
    await audit.probe({
      module: "Vendas",
      route: "/sales/orders",
      button: "Novo pedido",
      locate: createBtn(NEW_RE),
      expectAfter: async (p) =>
        await expect(p).toHaveURL(/\/sales\/orders\/new/i, { timeout: 10_000 }),
    });
  });
});

test.describe("Botões críticos — Compras", () => {
  test("Compras · Novo pedido", async ({ audit, page }) => {
    await audit.goto("/purchase/orders");
    await audit.probe({
      module: "Compras",
      route: "/purchase/orders",
      button: "Novo pedido de compra",
      locate: createBtn(NEW_RE),
      expectAfter: async (p) =>
        await expect(p).toHaveURL(/\/purchase\/orders\/new/i, { timeout: 10_000 }),
    });
  });

  test("Necessidades · listagem", async ({ audit, page }) => {
    await audit.goto("/purchase/needs");
    test.info().annotations.push({ type: "module", description: "Compras" });
    test.info().annotations.push({ type: "button", description: "Listar necessidades" });
    await expect(page.locator("body")).toContainText(/necessidade/i);
  });
});

test.describe("Botões críticos — Manufatura", () => {
  test('Manufatura · "Criar Ordem de Produção"', async ({ audit, page }) => {
    await audit.goto("/manufacturing/orders");
    await audit.probe({
      module: "Manufatura",
      route: "/manufacturing/orders",
      button: "Criar Ordem de Produção",
      locate: (p) =>
        p.getByRole("button", { name: /(criar ordem|nov[oa]|criar)/i })
         .or(p.getByRole("link", { name: /(criar ordem|nov[oa]|criar)/i })),
      expectAfter: async (p) =>
        await expect(p.getByRole("dialog")).toBeVisible({ timeout: 10_000 }),
      suggestion:
        "Verificar permissões mfg_can_manage e enum mo_state (não usar 'confirmed').",
    });
  });
});

test.describe("Botões críticos — Chão de Fábrica", () => {
  test("Painel carrega colunas", async ({ audit, page }) => {
    await audit.goto("/shop-floor");
    test.info().annotations.push({ type: "module", description: "Chão de Fábrica" });
    test.info().annotations.push({ type: "button", description: "(painel)" });
    await expect(page.locator("body")).toContainText(/(pronto|produ[çc][ãa]o|qualidade)/i);
  });
});

test.describe("Botões críticos — Entregas", () => {
  test("Entregas · Hoje", async ({ audit, page }) => {
    await audit.goto("/delivery");
    test.info().annotations.push({ type: "module", description: "Entregas" });
    test.info().annotations.push({ type: "button", description: "(hoje)" });
    await expect(page.locator("body")).toContainText(/(entregas|hoje|nada)/i);
  });
});

test.describe("Botões críticos — Caixa", () => {
  test("Caixa · listagem mostra abrir caixa", async ({ audit, page }) => {
    await audit.goto("/cashbox");
    test.info().annotations.push({ type: "module", description: "Caixa" });
    test.info().annotations.push({ type: "button", description: "Abrir/Fechar caixa" });
    await expect(page.locator("body")).toContainText(/caixa/i);
  });
});

test.describe("Botões críticos — Financeiro", () => {
  for (const r of [
    { module: "Financeiro", route: "/finance/payments", text: /(receb|pagamento)/i },
    { module: "Financeiro", route: "/finance/receivables", text: /(receber|fatura)/i },
    { module: "Financeiro", route: "/finance/payables", text: /(pagar|fornecedor)/i },
  ]) {
    test(`${r.module} · ${r.route}`, async ({ audit, page }) => {
      await audit.goto(r.route);
      test.info().annotations.push({ type: "module", description: r.module });
      test.info().annotations.push({ type: "route", description: r.route });
      test.info().annotations.push({ type: "button", description: "(página)" });
      await expect(page.locator("body")).toContainText(r.text);
    });
  }
});

test.describe("Botões críticos — Configurações", () => {
  test("Apps Instalados", async ({ audit, page }) => {
    await audit.goto("/settings/apps");
    test.info().annotations.push({ type: "module", description: "Configurações" });
    test.info().annotations.push({ type: "button", description: "Toggle módulos" });
    await expect(page.locator("body")).toContainText(/(apps|m[óo]dulos)/i);
  });
});
