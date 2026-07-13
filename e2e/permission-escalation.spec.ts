import { expect, test } from "@playwright/test";

/**
 * UX-009 / confirm-before-escalation:
 * Selecting a high-risk Grok permission mode must open confirmation UI
 * before sticky flags mutate. Cancel leaves the safe mode selected.
 */
test.describe("permission escalation confirmation", () => {
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

  test("bypass requires confirm dialog; cancel leaves manual", async ({
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
    await expect(page.getByTestId("prompt-composer")).toBeVisible();

    const summary = page.getByTestId("effective-policy-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute("data-elevated", "false");

    const select = page.getByTestId("permission-mode-select");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("manual");

    // Attempt escalation — must NOT mutate until Confirm.
    await select.selectOption("bypassPermissions");

    const dialog = page.getByTestId("permission-escalation-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(
      page.getByRole("dialog", { name: /elevated permissions/i })
    ).toBeVisible();
    await expect(dialog.getByText(/scope/i).first()).toBeVisible();
    await expect(dialog.getByText(/duration/i).first()).toBeVisible();

    // Controlled select remains on safe mode while dialog is open.
    await expect(select).toHaveValue("manual");
    await expect(summary).toHaveAttribute("data-elevated", "false");
    await expect(page.getByTestId("elevated-risk-indicator")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(select).toHaveValue("manual");
    await expect(summary).toHaveAttribute("data-elevated", "false");
  });

  test("confirm applies bypass and shows persistent elevated indicator", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("text=SPOK").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("welcome-play-sample").click();
    await expect(page.getByTestId("prompt-composer")).toBeVisible({
      timeout: 15_000,
    });

    const select = page.getByTestId("permission-mode-select");
    await select.selectOption("always-approve");

    const dialog = page.getByTestId("permission-escalation-dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: /enable always approve/i })
      .click();

    await expect(dialog).toHaveCount(0);
    await expect(select).toHaveValue("always-approve");
    await expect(page.getByTestId("effective-policy-summary")).toHaveAttribute(
      "data-elevated",
      "true"
    );
    await expect(page.getByTestId("elevated-risk-indicator")).toBeVisible();

    // De-escalation is immediate — no confirmation dialog.
    await select.selectOption("manual");
    await expect(
      page.getByTestId("permission-escalation-dialog")
    ).toHaveCount(0);
    await expect(select).toHaveValue("manual");
    await expect(page.getByTestId("effective-policy-summary")).toHaveAttribute(
      "data-elevated",
      "false"
    );
  });
});
