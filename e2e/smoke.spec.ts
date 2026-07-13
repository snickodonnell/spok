import { test, expect } from "@playwright/test";

/**
 * UI/UX smoke: welcome shell, theme tokens, settings, keyboard help, diagnostics.
 * Does not require Grok CLI.
 */
test.describe("Spok shell smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/sessions", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [] }),
      });
    });
  });

  test("loads welcome screen with skip link and main landmark", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("text=SPOK").first()).toBeVisible({
      timeout: 30_000,
    });
    // Skip link present for keyboard users
    await expect(page.locator('a.skip-link[href="#spok-main"]')).toHaveCount(1);
    await expect(page.locator("#spok-main")).toHaveCount(1);
    // Default professional theme on html
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      /professional|crt|high-contrast/
    );
  });

  test("command palette opens with Ctrl+K", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=SPOK").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.keyboard.press("Control+k");
    await expect(
      page.getByPlaceholder(/type a command or search/i)
    ).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.press("Escape");
  });

  test("opens settings and appearance tab themes", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=SPOK").first()).toBeVisible({
      timeout: 30_000,
    });
    // Topbar settings gear
    await page.getByTitle(/settings & permissions/i).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await settings.getByRole("tab", { name: "Appearance" }).click();
    await expect(settings.getByRole("button", { name: /professional/i })).toBeVisible();
    await expect(settings.getByRole("button", { name: /crt phosphor/i })).toBeVisible();
    await expect(settings.getByRole("button", { name: /high contrast/i })).toBeVisible();
    // Live switch to high contrast
    await settings.getByRole("button", { name: /high contrast/i }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "high-contrast"
    );
  });

  test("keyboard help via ?", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=SPOK").first()).toBeVisible({
      timeout: 30_000,
    });
    // Focus body so ? is not typed into an input
    await page.locator("body").click();
    await page.keyboard.press("Shift+/"); // ?
    await expect(page.getByText(/keyboard shortcuts/i)).toBeVisible({
      timeout: 5_000,
    });
  });

  test("play sample reaches workspace chrome", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=SPOK").first()).toBeVisible({
      timeout: 30_000,
    });
    const demo = page.getByTestId("welcome-play-sample");
    await expect(demo).toBeVisible();
    await demo.click();
    await expect(page.getByTestId("workspace")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("run-status-card")).toBeVisible();
    await expect(page.getByTestId("prompt-composer")).toBeVisible();
    // Task-oriented right tabs
    await expect(page.getByRole("tab", { name: /changes/i })).toBeVisible();
  });

  test("welcome shows CLI readiness strip", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("welcome-screen")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("welcome-readiness")).toBeVisible();
    await expect(page.getByTestId("welcome-open-repo")).toBeVisible();
  });

  test("product mode nav is present after sample", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=SPOK").first()).toBeVisible({
      timeout: 30_000,
    });
    const demo = page.getByTestId("welcome-play-sample");
    await expect(demo).toBeVisible();
    await demo.click();
    await expect(page.getByTestId("product-mode-nav")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("product-mode-nav").getByRole("button", { name: "Run" })
    ).toBeVisible();
  });

  test("workspace right tabs: changes review validation events health", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("text=SPOK").first()).toBeVisible({
      timeout: 30_000,
    });
    const demo = page.getByTestId("welcome-play-sample");
    await expect(demo).toBeVisible();
    await demo.click();
    await expect(page.getByTestId("workspace")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("workspace-right-tabs")).toBeVisible();
    await expect(page.getByTestId("tab-changes")).toBeVisible();
    await expect(page.getByTestId("tab-review")).toBeVisible();
    await expect(page.getByTestId("tab-validation")).toBeVisible();
    await expect(page.getByTestId("tab-events")).toBeVisible();
    await expect(page.getByTestId("tab-health")).toBeVisible();

    await page.getByTestId("tab-validation").click();
    await page.getByTestId("tab-events").click();
    await expect(page.getByTestId("log-panel")).toBeVisible();
    await page.getByTestId("tab-review").click();
    await page.getByTestId("tab-changes").click();
    await page.getByTestId("tab-health").click();
  });

  test("composer exposes attach control", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=SPOK").first()).toBeVisible({
      timeout: 30_000,
    });
    const demo = page.getByTestId("welcome-play-sample");
    await expect(demo).toBeVisible();
    await demo.click();
    await expect(page.getByTestId("prompt-composer")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("composer-attach")).toBeVisible();
  });
});
