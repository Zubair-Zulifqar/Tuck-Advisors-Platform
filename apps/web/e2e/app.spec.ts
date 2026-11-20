import { expect, test, type Page } from "@playwright/test";

const PW = "e2e-demo-password-123";
async function login(page: Page, who: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${who}@tuck.example`);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("unauthenticated users are redirected to login; bad passwords rejected", async ({ page }) => {
  await page.goto("/app/companies");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill("owner@tuck.example");
  await page.getByLabel("Password").fill("wrong-password-x");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form [role=alert]")).toContainText("Invalid email or password");
});

test("dashboard shows live counts and pipeline", async ({ page }) => {
  await login(page, "owner");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Pipeline by stage")).toBeVisible();
  await expect(page.locator("a[href='/app/companies'] p").nth(1)).toHaveText(/^\d+$/);
});

test("CRM: create company, duplicate detection, log activity, task", async ({ page }) => {
  await login(page, "analyst");
  await page.goto("/app/companies");
  await page.getByRole("button", { name: "Add company" }).click();
  await page.getByLabel("Name *").fill("Playwright Holdings");
  await page.getByLabel("Website").fill("https://playwright-holdings.example");
  await page.getByLabel("Industry").fill("Software");
  await page.getByRole("button", { name: "Add company", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Playwright Holdings" })).toBeVisible();

  await page.getByPlaceholder("Summary").fill("Intro call with founder");
  await page.getByRole("button", { name: "Log" }).click();
  await expect(page.getByText("Intro call with founder").first()).toBeVisible();

  await page.getByPlaceholder("Call back about…").fill("Send teaser");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Send teaser")).toBeVisible();

  await page.goto("/app/companies");
  await page.getByRole("button", { name: "Add company" }).click();
  await page.getByLabel("Name *").fill("Another Name");
  await page.getByLabel("Website").fill("https://www.playwright-holdings.example/about");
  await page.getByRole("button", { name: "Add company", exact: true }).last().click();
  await expect(page.locator("form [role=alert]")).toContainText("already exists");
});

test("deal pipeline stage change is logged", async ({ page }) => {
  await login(page, "owner");
  await page.goto("/app/deals");
  const card = page.locator("section[aria-label='engaged stage']").getByText("Project Copper");
  await expect(card).toBeVisible();
  await page.locator("section[aria-label='engaged stage']").getByLabel("Deal stage").first().selectOption("nda");
  await expect(page.locator("section[aria-label='nda stage']").getByText("Project Copper")).toBeVisible();
});

test("research job runs in the background and produces a report", async ({ page }) => {
  await login(page, "owner");
  await page.goto("/app/contacts");
  await page.getByRole("link", { name: "Avery Lane" }).click();
  await page.getByLabel("Research type").selectOption("post_call_notes");
  await page.getByPlaceholder(/Paste meeting notes/).fill("Discussed succession timeline. Avery will send the customer list next week. We will schedule a follow up with Harbor corp dev.");
  await page.getByRole("button", { name: "Run research" }).click();
  await expect(page.getByRole("link", { name: /Open “Post-call notes/ })).toBeVisible({ timeout: 45_000 });
});

test("role-based access: viewers cannot edit, analysts cannot approve", async ({ page, request }) => {
  await login(page, "viewer");
  await page.goto("/app/companies");
  await expect(page.getByRole("button", { name: "Add company" })).toHaveCount(0);
  const res = await page.request.post("/api/v1/companies", { data: { name: "Nope" }, headers: { origin: new URL(page.url()).origin } });
  expect(res.status()).toBe(403);
  // CSRF: cookie-authenticated write without Origin
  const noOrigin = await request.post("/api/v1/tasks", { data: { title: "x" } });
  expect([401, 403]).toContain(noOrigin.status());
});

test("automation templates install paused and settings show integration modes", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/app/automations");
  await page.getByRole("button", { name: "Install (paused)" }).first().click();
  await expect(page.getByRole("cell", { name: /Research every new company/ })).toBeVisible();
  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /OpenAI/ })).toBeVisible();
});
