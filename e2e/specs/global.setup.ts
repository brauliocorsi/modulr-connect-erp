import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const AUTH_FILE = "e2e/.auth/admin.json";

setup("authenticate as admin", async ({ page }) => {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "Missing E2E_EMAIL / E2E_PASSWORD env vars. Set them before running the suite.",
    );
  }
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(EMAIL);
  await page.getByLabel(/(senha|password|palavra-passe)/i).fill(PASSWORD);
  await page.getByRole("button", { name: /(entrar|sign in|login)/i }).click();

  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/login/);

  await page.context().storageState({ path: AUTH_FILE });
});
