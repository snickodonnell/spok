import { expect, test, type Page } from "@playwright/test";

/**
 * UX-009 / confirm-before-escalation:
 * Selecting a high-risk Grok permission mode must open confirmation UI
 * before sticky flags mutate. Cancel leaves the safe mode selected.
 * Slash /permission-mode and /always-approve use the same gate.
 */

async function openDemoWorkspace(page: Page) {
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
}

async function submitComposerText(page: Page, text: string) {
  const composer = page.getByTestId("prompt-composer");
  const input = composer.locator("textarea").first();
  await input.fill(text);
  await composer.getByRole("button", { name: "Send" }).click();
}

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
    await openDemoWorkspace(page);

    const summary = page.getByTestId("effective-policy-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toHaveAttribute("data-elevated", "false");

    const select = page.getByTestId("permission-mode-select");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("manual");

    await select.selectOption("bypassPermissions");

    const dialog = page.getByTestId("permission-escalation-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(
      page.getByRole("dialog", { name: /elevated permissions/i })
    ).toBeVisible();
    await expect(dialog.getByText(/scope/i).first()).toBeVisible();
    await expect(dialog.getByText(/duration/i).first()).toBeVisible();

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
    await openDemoWorkspace(page);

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

    await expect(page.getByTestId("policy-chrome-topbar")).toHaveAttribute(
      "data-elevated",
      "true"
    );
    await expect(page.getByTestId("policy-chrome-run-status")).toHaveAttribute(
      "data-elevated",
      "true"
    );

    await select.selectOption("manual");
    await expect(
      page.getByTestId("permission-escalation-dialog")
    ).toHaveCount(0);
    await expect(select).toHaveValue("manual");
    await expect(page.getByTestId("effective-policy-summary")).toHaveAttribute(
      "data-elevated",
      "false"
    );
    await expect(page.getByTestId("policy-chrome-topbar")).toHaveAttribute(
      "data-elevated",
      "false"
    );
  });

  test("slash /always-approve cancel leaves state unchanged", async ({
    page,
  }) => {
    await openDemoWorkspace(page);

    const select = page.getByTestId("permission-mode-select");
    await expect(select).toHaveValue("manual");
    await expect(page.getByTestId("effective-policy-summary")).toHaveAttribute(
      "data-elevated",
      "false"
    );

    await submitComposerText(page, "/always-approve");

    const dialog = page.getByTestId("permission-escalation-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/scope/i).first()).toBeVisible();
    await expect(dialog.getByText(/duration/i).first()).toBeVisible();

    await expect(select).toHaveValue("manual");
    await expect(page.getByTestId("effective-policy-summary")).toHaveAttribute(
      "data-elevated",
      "false"
    );

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(select).toHaveValue("manual");
    await expect(page.getByTestId("effective-policy-summary")).toHaveAttribute(
      "data-elevated",
      "false"
    );
    await expect(page.getByTestId("policy-chrome-topbar")).toHaveAttribute(
      "data-elevated",
      "false"
    );
  });

  test("slash /permission-mode bypass confirms then elevates chrome", async ({
    page,
  }) => {
    await openDemoWorkspace(page);

    const select = page.getByTestId("permission-mode-select");
    await submitComposerText(page, "/permission-mode bypassPermissions");

    const dialog = page.getByTestId("permission-escalation-dialog");
    await expect(dialog).toBeVisible();
    await expect(select).toHaveValue("manual");

    await dialog
      .getByRole("button", { name: /enable bypass permissions/i })
      .click();

    await expect(dialog).toHaveCount(0);
    await expect(select).toHaveValue("bypassPermissions");
    await expect(page.getByTestId("effective-policy-summary")).toHaveAttribute(
      "data-elevated",
      "true"
    );
    await expect(page.getByTestId("elevated-risk-indicator")).toBeVisible();
    await expect(page.getByTestId("policy-chrome-run-status")).toHaveAttribute(
      "data-elevated",
      "true"
    );
    await expect(page.getByTestId("policy-chrome-topbar")).toHaveAttribute(
      "data-elevated",
      "true"
    );

    await submitComposerText(page, "/permission-mode plan");
    await expect(
      page.getByTestId("permission-escalation-dialog")
    ).toHaveCount(0);
    await expect(select).toHaveValue("plan");
    await expect(page.getByTestId("effective-policy-summary")).toHaveAttribute(
      "data-elevated",
      "false"
    );
  });

  test("slash /always-approve de-escalation is immediate", async ({ page }) => {
    await openDemoWorkspace(page);

    const select = page.getByTestId("permission-mode-select");
    await submitComposerText(page, "/always-approve");
    const dialog = page.getByTestId("permission-escalation-dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: /enable always approve/i })
      .click();
    await expect(select).toHaveValue("always-approve");

    await submitComposerText(page, "/always-approve");
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
