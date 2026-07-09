import { test, expect } from "@playwright/test";

/**
 * UI/UX smoke: welcome shell, theme tokens, settings, keyboard help, diagnostics.
 * Does not require Grok CLI.
 */
test.describe("Spok shell smoke", () => {
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
    await expect(page.getByText(/settings & permissions/i)).toBeVisible();
    await page.getByRole("tab", { name: /appearance/i }).click();
    await expect(page.getByText(/professional/i).first()).toBeVisible();
    await expect(page.getByText(/crt phosphor/i)).toBeVisible();
    await expect(page.getByText(/high contrast/i)).toBeVisible();
    // Live switch to high contrast
    await page.getByRole("button", { name: /high contrast/i }).click();
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

  test("play demo sample reaches workspace chrome", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=SPOK").first()).toBeVisible({
      timeout: 30_000,
    });
    const demo = page.getByRole("button", { name: /play demo sample/i });
    if (await demo.isVisible().catch(() => false)) {
      await demo.click();
      // Metrics or timeline or composer should appear
      await expect(
        page.locator("text=/workspace|thinking|diff|prompt/i").first()
      ).toBeVisible({ timeout: 15_000 });
    }
  });
});
