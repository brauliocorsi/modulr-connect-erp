# F29 — Fase 6 (Bloco 9) — Conciliação Bancária

## Auditoria

- `BankStatementImportPage` (`/finance/bank-import`) já existia com suporte CSV/XLS/XLSX, wizard 3 passos, auto-match contra `customer_payments` (±3 dias, mesmo valor, filtro por método de pagamento).
- `ReconciliationPage` (`/finance/reconciliation`) já cobre a conciliação venda↔recebimento.
- Backend completo: `bank_statement_import_create`, `bank_statement_line_insert`, `bank_reconciliation_confirm_match`, `bank_reconciliation_unmatch`.

## Bloco 9 — Acrescentado nesta fase

**Suporte OFX/QFX** no `BankStatementImportPage`:
- Parser SGML→texto para extrair `<STMTTRN>` (DTPOSTED, MEMO/NAME, FITID, TRNAMT).
- `accept` do `<input file>` passa a aceitar `.ofx,.qfx`.
- Auto-mapping reconhece os cabeçalhos normalizados (Data/Descrição/Referência/Valor).
- Resto do fluxo (auto-match, sugestões, confirmação) reutilizado sem alterações.

## Próximas fases

- **Fase 7 (Bloco 10):** Pipeline de estados em vendas + notificações realtime globais.
- **Fase 8 (Bloco 11):** Já feito na Fase 1 (migração BNPL).
