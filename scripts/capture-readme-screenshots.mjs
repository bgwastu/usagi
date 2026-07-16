/**
 * Captures the README screenshot by mocking /api/accounts in Chromium.
 * Not imported by the Next.js app — demo fixtures stay out of production.
 *
 *   bun add -d playwright && bunx playwright install chromium
 *   bun scripts/capture-readme-screenshots.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readmeDemoAccounts } from "./readme-demo-accounts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "docs", "screenshots");
const baseUrl = process.env.USAGI_URL ?? "http://localhost:3000";
const demo = readmeDemoAccounts();

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const page = await context.newPage();

await page.route("**/api/accounts", async (route) => {
  if (route.request().method() === "GET") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(demo),
    });
    return;
  }
  await route.continue();
});

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.addStyleTag({
  content: "nextjs-portal, [data-nextjs-toast] { display: none !important; }",
});
await page.getByRole("region", { name: "Provider accounts" }).waitFor({
  timeout: 15_000,
});
await page.waitForTimeout(700);

const darkPath = join(outDir, "board-dark.png");
await page.screenshot({ path: darkPath, fullPage: false });
console.log("wrote", darkPath);

await browser.close();
