import { expect, test } from "@playwright/test";

test("repository selection grants no authority until explicit trust", async ({ page }) => {
  let trustGrants = 0;
  await page.addInitScript(() => {
    localStorage.setItem("spok.lastCwd", "C:\\dev\\spok");
  });
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [] }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/workspace/trust", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ trustedRoots: [], roots: [] }),
      });
      return;
    }
    if (route.request().method() === "POST") {
      trustGrants += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, root: "C:\\dev\\spok" }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await expect(page.locator('[data-shell-usable="true"]')).toBeVisible({ timeout: 2_500 });
  await page.getByTestId("welcome-open-repo").click();
  await expect(page.getByTestId("launch-authority-receipt")).toBeVisible();
  await expect(page.getByText(/selection grants no authority/i).first()).toBeVisible();
  await expect(page.getByTestId("launch-trust-confirmation")).toBeVisible();

  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByTestId("launch-problem")).toContainText(
    /confirm repository trust/i
  );
  expect(trustGrants).toBe(0);

  await page.getByTestId("launch-trust-confirmation").check();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByTestId("workspace")).toBeVisible({ timeout: 10_000 });
  expect(trustGrants).toBe(1);
});
