import { test, expect } from '@playwright/test';

/**
 * Phase 17 — Golden Flow UpMóveis (Smoke leve)
 *
 * Este spec apenas verifica que as páginas centrais do fluxo carregam sem erro
 * para um utilizador autenticado. O backend RPC já é validado de ponta a ponta
 * via `_test_phase17_golden_flow` (47/47 asserts, ver migrations).
 *
 * Passos UI completos (criar SO → confirmar → MO → WO → fechar → entrega →
 * pagamento) ficam documentados como GAP_P2 enquanto a UI não tem ainda
 * formulários estáveis para todos os steps.
 */

const ROUTES = [
  { path: '/sale-orders', label: 'Sale Orders' },
  { path: '/purchase-needs', label: 'Purchase Needs' },
  { path: '/purchase-orders', label: 'Purchase Orders' },
  { path: '/manufacturing-orders', label: 'Manufacturing Orders' },
  { path: '/delivery-routes', label: 'Delivery Routes' },
  { path: '/customer-payments', label: 'Customer Payments' },
];

test.describe('06 — Golden Flow UpMóveis smoke', () => {
  for (const r of ROUTES) {
    test(`carrega ${r.label}`, async ({ page }) => {
      const resp = await page.goto(r.path, { waitUntil: 'domcontentloaded' });
      expect(resp?.ok() || resp?.status() === 304).toBeTruthy();
      // página deve renderizar sem boundary de erro visível
      await expect(page.locator('text=/something went wrong|application error/i')).toHaveCount(0);
    });
  }

  test.skip('fluxo completo SO→MO→entrega→pagamento (GAP_P2)', async () => {
    // Documentado como P2: a UI ainda não expõe RPCs `delivery_route_create_ad_hoc`,
    // `delivery_pick_to_dock`, `delivery_load_vehicle`, `delivery_verify_load`,
    // `delivery_route_start`, `delivery_order_deliver` num único wizard estável.
    // Validação ponta-a-ponta é feita via _test_phase17_golden_flow (backend).
  });
});
