import { test as base, expect, Page, ConsoleMessage } from "@playwright/test";

type Fixtures = {
  consoleErrors: string[];
  audit: AuditHelper;
};

type ProbeOpts = {
  module: string;
  route?: string;
  button: string;
  /** Selector or role-based locator factory */
  locate: (page: Page) => ReturnType<Page["locator"]>;
  /** Optional follow-up assertion (modal opens, toast appears, URL changes…). */
  expectAfter?: (page: Page) => Promise<void>;
  /** Suggested fix if the probe fails (free-form). */
  suggestion?: string;
};

class AuditHelper {
  constructor(private page: Page, private errors: string[]) {}

  async probe(opts: ProbeOpts) {
    const { test } = await import("@playwright/test");
    test.info().annotations.push({ type: "module", description: opts.module });
    if (opts.route)
      test.info().annotations.push({ type: "route", description: opts.route });
    test.info().annotations.push({ type: "button", description: opts.button });
    if (opts.suggestion)
      test.info().annotations.push({ type: "suggestion", description: opts.suggestion });

    const before = this.errors.length;
    const loc = opts.locate(this.page);
    await expect(loc, `botão "${opts.button}" não encontrado`).toBeVisible({
      timeout: 10_000,
    });
    await loc.first().click();

    if (opts.expectAfter) await opts.expectAfter(this.page);

    const newErrors = this.errors.slice(before);
    if (newErrors.length) {
      test.info().attach("console-errors", {
        body: JSON.stringify(newErrors),
        contentType: "application/json",
      });
      throw new Error(`Console errors após clicar "${opts.button}": ${newErrors[0]}`);
    }
  }

  async goto(route: string) {
    await this.page.goto(route, { waitUntil: "domcontentloaded" });
    await this.page.waitForLoadState("networkidle").catch(() => {});
  }
}

export const test = base.extend<Fixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    const onConsole = (msg: ConsoleMessage) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (
          /Failed to load resource|favicon|sentry|hot-update|Download the React DevTools/i.test(
            text,
          )
        )
          return;
        errors.push(text);
      }
    };
    const onPageError = (err: Error) => errors.push(err.message);
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    await use(errors);
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  },
  audit: async ({ page, consoleErrors }, use) => {
    await use(new AuditHelper(page, consoleErrors));
  },
});

export { expect };
