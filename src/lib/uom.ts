// Helpers for unit-of-measure logic
export type UomCategory = "unit" | "weight" | "length" | "volume" | "time" | string;

export function isIntegerCategory(category?: string | null): boolean {
  if (!category) return true; // default safe: integers
  return category === "unit";
}

export function qtyStep(category?: string | null): number {
  return isIntegerCategory(category) ? 1 : 0.01;
}

export function normalizeQty(value: number, category?: string | null): number {
  if (!Number.isFinite(value)) return 0;
  if (isIntegerCategory(category)) return Math.max(0, Math.floor(value));
  return Math.max(0, Math.round(value * 100) / 100);
}
