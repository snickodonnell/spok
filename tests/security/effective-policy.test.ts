import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEffectivePolicySummary,
  buildEscalationConfirmation,
  currentProviderSelection,
  flagsForProviderSelection,
  isDeescalationOrSafeChange,
  isHighRiskProviderMode,
  requiresEscalationConfirmation,
  type ProviderPermissionSelection,
} from "../../src/lib/security/effective-policy";

describe("effective policy — provider selection", () => {
  it("defaults to manual when flags are empty", () => {
    assert.equal(currentProviderSelection({}), "manual");
    assert.equal(
      currentProviderSelection({ alwaysApprove: false }),
      "manual"
    );
  });

  it("prefers alwaysApprove over permissionMode", () => {
    assert.equal(
      currentProviderSelection({
        alwaysApprove: true,
        permissionMode: "plan",
      }),
      "always-approve"
    );
  });

  it("reads sticky permissionMode when set", () => {
    assert.equal(
      currentProviderSelection({
        alwaysApprove: false,
        permissionMode: "bypassPermissions",
      }),
      "bypassPermissions"
    );
  });
});

describe("effective policy — escalation gate", () => {
  const high: ProviderPermissionSelection[] = [
    "dontAsk",
    "bypassPermissions",
    "always-approve",
  ];
  const safe: ProviderPermissionSelection[] = [
    "manual",
    "default",
    "plan",
    "acceptEdits",
    "auto",
  ];

  it("blocks escalation to high-risk modes without confirm (gate true)", () => {
    for (const to of high) {
      assert.equal(
        requiresEscalationConfirmation("manual", to),
        true,
        `manual → ${to}`
      );
      assert.equal(
        requiresEscalationConfirmation("auto", to),
        true,
        `auto → ${to}`
      );
    }
  });

  it("does not require confirm when already on the same high-risk mode", () => {
    for (const mode of high) {
      assert.equal(requiresEscalationConfirmation(mode, mode), false);
    }
  });

  it("requires confirm when switching between distinct high-risk modes", () => {
    assert.equal(
      requiresEscalationConfirmation("dontAsk", "bypassPermissions"),
      true
    );
    assert.equal(
      requiresEscalationConfirmation("bypassPermissions", "always-approve"),
      true
    );
  });

  it("de-escalation to safer modes is immediate (no confirm)", () => {
    for (const from of high) {
      for (const to of safe) {
        assert.equal(
          requiresEscalationConfirmation(from, to),
          false,
          `${from} → ${to}`
        );
        assert.equal(isDeescalationOrSafeChange(from, to), true);
      }
    }
  });

  it("non-high-risk changes do not require confirmation", () => {
    assert.equal(requiresEscalationConfirmation("manual", "auto"), false);
    assert.equal(requiresEscalationConfirmation("manual", "acceptEdits"), false);
    assert.equal(requiresEscalationConfirmation("auto", "plan"), false);
  });

  it("flagsForProviderSelection mutates only after explicit apply path", () => {
    // Confirm path uses this helper — selection alone does not touch store.
    assert.deepEqual(flagsForProviderSelection("bypassPermissions"), {
      alwaysApprove: false,
      permissionMode: "bypassPermissions",
    });
    assert.deepEqual(flagsForProviderSelection("always-approve"), {
      alwaysApprove: true,
      permissionMode: undefined,
    });
    assert.deepEqual(flagsForProviderSelection("manual"), {
      alwaysApprove: false,
      permissionMode: undefined,
    });
  });

  it("confirm apply then de-escalate: flags round-trip", () => {
    // Simulate: pending → confirm → flags; then de-escalate immediately.
    const elevated = flagsForProviderSelection("bypassPermissions");
    assert.equal(currentProviderSelection(elevated), "bypassPermissions");
    assert.equal(isHighRiskProviderMode("bypassPermissions"), true);

    const safeFlags = flagsForProviderSelection("manual");
    assert.equal(currentProviderSelection(safeFlags), "manual");
    assert.equal(
      requiresEscalationConfirmation("bypassPermissions", "manual"),
      false
    );
  });
});

describe("effective policy — summary fields", () => {
  it("builds summary with app mode, provider, risk, precedence", () => {
    const summary = buildEffectivePolicySummary({
      appPermissionMode: "manual",
      flags: { alwaysApprove: false },
      cwd: "C:\\dev\\spok",
    });
    assert.equal(summary.appMode, "manual");
    assert.equal(summary.providerSelection, "manual");
    assert.equal(summary.elevated, false);
    assert.equal(summary.riskTier, "low");
    assert.ok(summary.headline.toLowerCase().includes("manual"));
    assert.ok(summary.precedence.length >= 3);
    assert.ok(
      summary.precedence.some((p) => /deny rules always win/i.test(p))
    );
    assert.ok(summary.providerDetail.some((d) => d.key === "App permission mode"));
    assert.ok(summary.scope.length > 0);
    assert.ok(summary.duration.length > 0);
  });

  it("marks elevated when provider is bypass or always-approve", () => {
    const bypass = buildEffectivePolicySummary({
      appPermissionMode: "manual",
      flags: { permissionMode: "bypassPermissions" },
    });
    assert.equal(bypass.elevated, true);
    assert.equal(bypass.riskTier, "critical");
    assert.match(bypass.headline, /elevated/i);

    const always = buildEffectivePolicySummary({
      appPermissionMode: "acceptEdits",
      flags: { alwaysApprove: true },
    });
    assert.equal(always.elevated, true);
    assert.equal(always.providerSelection, "always-approve");
  });

  it("marks elevated when app mode is bypass even if provider is manual", () => {
    const summary = buildEffectivePolicySummary({
      appPermissionMode: "bypass",
      flags: {},
    });
    assert.equal(summary.elevated, true);
    assert.equal(summary.riskTier, "critical");
  });

  it("escalation confirmation copy includes scope, duration, risk", () => {
    const copy = buildEscalationConfirmation("bypassPermissions", {
      cwd: "C:\\dev\\trusted",
    });
    assert.match(copy.title, /bypass/i);
    assert.match(copy.description, /will not change until you confirm/i);
    assert.match(copy.scope, /session/i);
    assert.match(copy.duration, /until you switch/i);
    assert.ok(copy.riskExplanation.length > 10);
    assert.ok(copy.detail.includes("Scope:"));
    assert.ok(copy.detail.includes("Duration:"));
    assert.equal(copy.tone, "danger");
    assert.equal(copy.selection, "bypassPermissions");
  });

  it("dontAsk confirmation uses amber tone (high, not critical)", () => {
    const copy = buildEscalationConfirmation("dontAsk");
    assert.equal(copy.tone, "amber");
    assert.match(copy.detail, /Don't ask|Don\x27t ask|dontAsk|prompts/i);
  });
});
