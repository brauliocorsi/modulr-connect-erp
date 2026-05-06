export const LOCALE = "pt-PT";
export const CURRENCY = "EUR";

export const fmtMoney = (n: number | string | null | undefined) =>
  new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY }).format(Number(n ?? 0));

export const fmtNumber = (n: number | string | null | undefined, digits = 2) =>
  new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(n ?? 0));

export const fmtDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString(LOCALE) : "—";

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString(LOCALE) : "—";
