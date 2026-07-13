import { expect, test, type Page } from "@playwright/test";

async function expectShellUsable(page: Page, timeout = 2_500) {
  await expect(page.locator('[data-shell-usable="true"]').first()).toBeVisible({
    timeout,
  });
}

test.describe("startup recovery", () => {
  test("desktop reaches a usable shell within the startup budget", async ({ page }) => {
    await page.goto("/");
    await expectShellUsable(page);
  });

  test("mobile reaches a usable shell within the startup budget", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mobile=1");
    await expectShellUsable(page);
    await expect(page.getByTestId("mobile-shell")).toBeVisible();
  });

  test("failed restore exposes retry, continue, and diagnostics", async ({ page }) => {
    await page.route("**/api/sessions", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Session store unavailable" }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("startup-recovery")).toBeVisible({ timeout: 2_500 });
    await expect(page.getByText(/list saved sessions/i)).toBeVisible();
    await expect(page.getByTestId("startup-retry")).toBeVisible();
    await expect(page.getByTestId("startup-continue")).toBeVisible();
    await expect(page.getByTestId("startup-diagnostics")).toBeVisible();

    await page.unroute("**/api/sessions");
    await page.route("**/api/sessions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [] }),
      });
    });
    await page.getByTestId("startup-retry").click();
    await expect(page.getByTestId("startup-recovery")).toBeHidden();
    await expectShellUsable(page);
  });

  test("slow restore times out to an actionable state and can be skipped", async ({ page }) => {
    let releaseRestore!: () => void;
    const stalledRestore = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    await page.route("**/api/sessions", async (route) => {
      await stalledRestore;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [] }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("startup-recovery")).toBeVisible({ timeout: 4_000 });
    await expect(page.getByText(/did not respond within 2.5 seconds/i)).toBeVisible();
    await page.getByTestId("startup-continue").click();
    releaseRestore();
    await expect(page.getByTestId("startup-recovery")).toBeHidden();
    await expectShellUsable(page);
  });

  test("corrupt restored body remains visibly unavailable", async ({ page }) => {
    const meta = {
      id: "corrupt-session",
      name: "Corrupt restored session",
      status: "completed",
      createdAt: 1,
      updatedAt: 2,
      source: "live",
      cwd: "C:\\dev\\corrupt",
      command: "grok",
      eventCount: 4,
      rawCount: 1,
      formatVersion: 1,
    };
    await page.route("**/api/sessions**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/sessions") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [meta] }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{not valid json",
      });
    });

    await page.goto("/");
    await expectShellUsable(page);
    await expect(page.getByText("Corrupt restored session").first()).toBeVisible();
    await expect(page.getByText(/saved session details are unavailable/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe("mobile lifecycle intent", () => {
  test("hide, unload, freeze, and layout changes never stop a run", async ({ page }) => {
    let stopRequests = 0;
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
    await page.route("**/api/session/start?*", async (route) => {
      if (route.request().method() === "DELETE") stopRequests += 1;
      await route.fulfill({ status: 204, body: "" });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mobile=1");
    await expectShellUsable(page);
    await page.getByRole("button", { name: "Sample" }).first().click();

    await page.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("beforeunload"));
      document.dispatchEvent(new Event("freeze"));
    });

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "Desktop", exact: true }).click();
    await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(250);
    expect(stopRequests).toBe(0);
  });

  test("repository picker promises context switching without fleet stop", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mobile=1");
    await expectShellUsable(page);
    await page.getByRole("button", { name: /folder/i }).first().click();
    await expect(page.getByTestId("mobile-folder-picker")).toBeVisible();
    await expect(page.getByText(/unrelated runs keep working/i)).toBeVisible();
  });
});
