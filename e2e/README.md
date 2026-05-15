# Suite E2E Playwright — Auditoria botão-a-botão

## O que faz

1. **Login** com utilizador `system_admin` (variáveis `E2E_EMAIL` / `E2E_PASSWORD`)
2. **Smoke** de todos os módulos (`01-modules-smoke.spec.ts`) — confirma que a rota carrega
   e que não há erros no console
3. **Audita botões críticos** por módulo (`02-buttons-audit.spec.ts`) — clica
   "criar / novo / abrir modal" e verifica reação esperada
4. **Fluxos completos**:
   - `03-flow-purchase.spec.ts` — compra → recepção → venda → entrega → caixa
   - `04-flow-manufacturing.spec.ts` — BOM → MO → chão de fábrica → entrega

## Como correr

```bash
# 1. Instalar Playwright + browsers (uma vez)
bun add -d @playwright/test
bunx playwright install chromium

# 2. Definir credenciais (utilizador system_admin)
export E2E_EMAIL="..."
export E2E_PASSWORD="..."

# 3. (opcional) trocar URL alvo — por defeito usa o preview Lovable
export E2E_BASE_URL="https://id-preview--<project-id>.lovable.app"

# 4. Correr tudo
bunx playwright test

# UI mode interactivo
bunx playwright test --ui
```

## Relatórios gerados

- `e2e/report.audit.md` — **relatório botão-a-botão** com módulo, rota, botão,
  estado (✅/❌/⏭), erro, console errors, screenshot e sugestão de correção
- `e2e/report.audit.json` — mesma informação em JSON
- `e2e/report-html/index.html` — relatório nativo Playwright (traces, vídeos)
- `e2e/report.json` — JSON nativo Playwright

## Dados de teste

Todos os registos criados pela suite usam o prefixo `TESTE_E2E_` (ver
`e2e/lib/test-data.ts`) para nunca colidir com dados reais. Para limpar:

```sql
DELETE FROM products WHERE name LIKE 'TESTE_E2E_%';
DELETE FROM partners WHERE name LIKE 'TESTE_E2E_%';
```

## Estender a suite

Para adicionar um botão à auditoria, abre `02-buttons-audit.spec.ts` e adiciona:

```ts
test('Modulo · "Acção"', async ({ audit, page }) => {
  await audit.goto("/rota");
  await audit.probe({
    module: "Modulo",
    route: "/rota",
    button: "Acção",
    locate: (p) => p.getByRole("button", { name: /acção/i }),
    expectAfter: async (p) => await expect(p.getByRole("dialog")).toBeVisible(),
    suggestion: "...",
  });
});
```
