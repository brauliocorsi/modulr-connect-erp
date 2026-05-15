import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Limpeza final — apaga todos os registos com prefixo TESTE_E2E_.
 * Corre como último ficheiro (ordem alfabética: 99 > 05). Usa o utilizador
 * autenticado pelo storageState; se RLS bloquear, falha gracefully com aviso.
 */

test("Cleanup TESTE_E2E_*", async ({ page }) => {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    test.info().annotations.push({ type: "module", description: "Cleanup" });
    test.info().annotations.push({ type: "button", description: "(skip — sem env)" });
    return;
  }

  // Reaproveita a sessão do storageState
  const cookies = await page.context().cookies();
  const sbCookie = cookies.find((c) => c.name.includes("sb-") && c.name.endsWith("-auth-token"));
  const supabase = createClient(url, key, {
    global: sbCookie ? { headers: { cookie: `${sbCookie.name}=${sbCookie.value}` } } : undefined,
  });

  const tables = ["products", "partners"] as const;
  const summary: Record<string, number | string> = {};
  for (const t of tables) {
    const { error, count } = await supabase
      .from(t)
      .delete({ count: "exact" })
      .like("name", "TESTE_E2E_%");
    summary[t] = error ? `err:${error.message}` : (count ?? 0);
  }
  test.info().annotations.push({
    type: "module",
    description: "Cleanup",
  });
  test.info().annotations.push({
    type: "button",
    description: `Apagados: ${JSON.stringify(summary)}`,
  });
});
