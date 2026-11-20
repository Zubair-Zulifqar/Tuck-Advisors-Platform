import { expect, test } from "@playwright/test";

test("navigation across the public site", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The right buyer");
  for (const [link, heading] of [["Sell-side", "fire sale"], ["Buy-side", "aren't for sale"], ["Criteria", "buyer network"], ["About", "advisory firm"]] as const) {
    await page.getByRole("banner").getByRole("link", { name: link, exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 2 }).first()).toContainText(heading);
  }
  await page.goto("/privacy");
  await expect(page.getByText(/Saved analyses are deleted after 180 days/)).toBeVisible();
});

test("analyzer validates input client- and server-side", async ({ page }) => {
  await page.goto("/analyzer");
  await page.getByLabel("Target company website").fill("same.example");
  await page.getByLabel("Potential buyer website").fill("same.example");
  await page.getByRole("button", { name: "Analyze fit" }).click();
  await expect(page.locator("form [role=alert]")).toContainText("different companies");
  await page.getByLabel("Target company website").fill("http://127.0.0.1");
  await page.getByLabel("Potential buyer website").fill("https://other.example");
  await page.getByRole("button", { name: "Analyze fit" }).click();
  await expect(page.locator("form [role=alert]")).toContainText("public");
  await expect(page.getByText(/Not financial, legal, investment or valuation advice/)).toBeVisible();
});

test("contact form requires consent and submits a lead", async ({ page }) => {
  await page.goto("/contact?interest=sell_side");
  await page.getByLabel("Name").fill("E2E Founder");
  await page.getByLabel("Work email").fill("founder@e2e.example");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.locator("main [role=status]")).toContainText("received your note");
});

test("security headers are present", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});
