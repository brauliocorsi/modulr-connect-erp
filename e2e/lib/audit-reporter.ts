import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import fs from "node:fs";
import path from "node:path";

type Row = {
  module: string;
  spec: string;
  test: string;
  route?: string;
  button?: string;
  status: "OK" | "Falhou" | "Pulado";
  error?: string;
  consoleErrors?: string[];
  screenshot?: string;
  suggestion?: string;
  durationMs: number;
};

const rows: Row[] = [];

export default class AuditReporter implements Reporter {
  onBegin(_config: FullConfig) {
    rows.length = 0;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const annotations = Object.fromEntries(
      test.annotations.map((a) => [a.type, a.description ?? ""]),
    );
    const meta = (result as any).metadata ?? {};

    const screenshot = result.attachments.find((a) => a.name === "screenshot")?.path;
    const consoleAttachment = result.attachments.find(
      (a) => a.name === "console-errors",
    );
    let consoleErrors: string[] | undefined;
    if (consoleAttachment?.body) {
      try {
        consoleErrors = JSON.parse(consoleAttachment.body.toString());
      } catch {}
    }

    rows.push({
      module: annotations.module ?? meta.module ?? "—",
      spec: path.basename(test.location.file),
      test: test.title,
      route: annotations.route ?? meta.route,
      button: annotations.button ?? meta.button,
      status:
        result.status === "passed"
          ? "OK"
          : result.status === "skipped"
          ? "Pulado"
          : "Falhou",
      error: result.error?.message?.split("\n")[0],
      consoleErrors,
      screenshot: screenshot ? path.relative(process.cwd(), screenshot) : undefined,
      suggestion: annotations.suggestion,
      durationMs: result.duration,
    });
  }

  async onEnd(_result: FullResult) {
    const out = "e2e/report.audit.json";
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(rows, null, 2));

    const md = renderMarkdown(rows);
    fs.writeFileSync("e2e/report.audit.md", md);

    // eslint-disable-next-line no-console
    console.log(`\n[audit] wrote ${rows.length} rows → e2e/report.audit.{json,md}`);
  }
}

function renderMarkdown(rows: Row[]) {
  const ok = rows.filter((r) => r.status === "OK").length;
  const fail = rows.filter((r) => r.status === "Falhou").length;
  const skip = rows.filter((r) => r.status === "Pulado").length;

  const head = `# Auditoria E2E botão-a-botão\n\n**Total:** ${rows.length} · ✅ ${ok} · ❌ ${fail} · ⏭ ${skip}\n\n`;

  const groups: Record<string, Row[]> = {};
  for (const r of rows) (groups[r.module] ??= []).push(r);

  const sections = Object.entries(groups)
    .map(([mod, list]) => {
      const lines = list
        .map((r) => {
          const status = r.status === "OK" ? "✅" : r.status === "Falhou" ? "❌" : "⏭";
          const parts = [
            `- ${status} **${r.test}**`,
            r.button ? `botão: \`${r.button}\`` : null,
            r.route ? `rota: \`${r.route}\`` : null,
            r.error ? `erro: ${r.error}` : null,
            r.consoleErrors?.length ? `console: ${r.consoleErrors.length} err` : null,
            r.screenshot ? `[screenshot](${r.screenshot})` : null,
            r.suggestion ? `→ sugestão: ${r.suggestion}` : null,
          ].filter(Boolean);
          return parts.join(" · ");
        })
        .join("\n");
      return `## ${mod}\n\n${lines}\n`;
    })
    .join("\n");

  return head + sections;
}
