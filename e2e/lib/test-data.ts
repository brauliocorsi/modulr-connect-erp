/**
 * Helpers para gerar dados de teste com prefixo `TESTE_E2E_` para nunca colidir
 * com dados reais. Os fluxos E2E criam, usam e idealmente apagam estes registos.
 */
export const E2E_PREFIX = "TESTE_E2E_";

export function tag(name: string) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `${E2E_PREFIX}${stamp}_${name}`;
}

export const FIXED = {
  buyableProductName: `${E2E_PREFIX}PROD_COMPRADO`,
  manufacturedProductName: `${E2E_PREFIX}PROD_FABRICADO`,
  rawMaterialName: `${E2E_PREFIX}MATERIA_PRIMA`,
  customerName: `${E2E_PREFIX}CLIENTE`,
  supplierName: `${E2E_PREFIX}FORNECEDOR`,
  cashRegisterName: `${E2E_PREFIX}CAIXA`,
};
