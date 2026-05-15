import { test, expect } from "../lib/fixtures";

const ROUTES: { module: string; route: string; expect: RegExp }[] = [
  { module: "Home", route: "/", expect: /UP M[óo]veis ERP|aplicativo/i },
  { module: "Produtos", route: "/products", expect: /produtos/i },
  { module: "Inventário", route: "/inventory", expect: /(invent[áa]rio|stock|opera[çc][õo]es)/i },
  { module: "Barcode", route: "/barcode", expect: /(barcode|c[óo]digo de barras|scan)/i },
  { module: "Vendas", route: "/sales/orders", expect: /(pedidos|vendas|cota)/i },
  { module: "Compras", route: "/purchase/orders", expect: /(compras|pedidos de compra)/i },
  { module: "Manufatura", route: "/manufacturing", expect: /(manufatura|fabrica)/i },
  { module: "Chão de Fábrica", route: "/shop-floor", expect: /(ch[ãa]o de f[áa]brica|painel)/i },
  { module: "Entregas", route: "/delivery", expect: /(entregas|hoje)/i },
  { module: "Caixa", route: "/cashbox", expect: /(caixa|sess[ãa]o)/i },
  { module: "Financeiro", route: "/finance", expect: /(financeiro|recebimentos|dashboard)/i },
  { module: "Configurações", route: "/settings/apps", expect: /(apps|configura)/i },
];

test.describe("Smoke: navegar por todos os módulos", () => {
  for (const r of ROUTES) {
    test(`${r.module} carrega ${r.route}`, async ({ page, audit, consoleErrors }) => {
      test.info().annotations.push({ type: "module", description: r.module });
      test.info().annotations.push({ type: "route", description: r.route });
      test.info().annotations.push({ type: "button", description: "(navegação)" });

      await audit.goto(r.route);
      await expect(page.locator("body")).toContainText(r.expect, { timeout: 15_000 });

      const fatal = consoleErrors.filter((e) => !/aria-describedby|Description/i.test(e));
      if (fatal.length) {
        test.info().attach("console-errors", {
          body: JSON.stringify(fatal),
          contentType: "application/json",
        });
        throw new Error(`Console errors em ${r.route}: ${fatal[0]}`);
      }
    });
  }
});
