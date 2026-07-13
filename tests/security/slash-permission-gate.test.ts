import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gateProviderPermissionPatch,
  patchTouchesProviderPermission,
  targetSelectionFromPermissionPatch,
} from "../../src/lib/security/slash-permission-gate";

describe("slash permission gate — patch detection", () => {
  it("detects alwaysApprove and permissionMode patches", () => {
    assert.equal(patchTouchesProviderPermission({ alwaysApprove: true }), true);
    assert.equal(
      patchTouchesProviderPermission({ permissionMode: "plan" }),
      true
    );
    assert.equal(patchTouchesProviderPermission({ model: "grok" }), false);
    assert.equal(patchTouchesProviderPermission({ debug: true }), false);
  });
});

describe("slash permission gate — target selection", () => {
  it("maps always-approve on to always-approve", () => {
    assert.equal(
      targetSelectionFromPermissionPatch({}, { alwaysApprove: true }),
      "always-approve"
    );
  });

  it("maps always-approve off to manual when no sticky mode", () => {
    assert.equal(
      targetSelectionFromPermissionPatch(
        { alwaysApprove: true },
        { alwaysApprove: false }
      ),
      "manual"
    );
  });

  it("maps always-approve off to sticky permissionMode when present", () => {
    assert.equal(
      targetSelectionFromPermissionPatch(
        { alwaysApprove: true, permissionMode: "plan" },
        { alwaysApprove: false }
      ),
      "plan"
    );
  });

  it("maps permission-mode slash to that selection", () => {
    assert.equal(
      targetSelectionFromPermissionPatch(
        {},
        { permissionMode: "bypassPermissions" }
      ),
      "bypassPermissions"
    );
    assert.equal(
      targetSelectionFromPermissionPatch({}, { permissionMode: "auto" }),
      "auto"
    );
  });

  it("returns null for unknown permissionMode strings", () => {
    assert.equal(
      targetSelectionFromPermissionPatch({}, { permissionMode: "not-a-mode" }),
      null
    );
  });
});

describe("slash permission gate — confirm vs apply", () => {
  it("requires confirm for high-risk slash escalation", () => {
    const r = gateProviderPermissionPatch(
      { alwaysApprove: false },
      { alwaysApprove: true }
    );
    assert.equal(r.kind, "confirm");
    if (r.kind === "confirm") {
      assert.equal(r.selection, "always-approve");
      assert.equal(r.flags.alwaysApprove, true);
    }

    const bypass = gateProviderPermissionPatch(
      {},
      { permissionMode: "bypassPermissions" }
    );
    assert.equal(bypass.kind, "confirm");
    if (bypass.kind === "confirm") {
      assert.equal(bypass.selection, "bypassPermissions");
    }

    const dontAsk = gateProviderPermissionPatch(
      { permissionMode: "plan" },
      { permissionMode: "dontAsk" }
    );
    assert.equal(dontAsk.kind, "confirm");
  });

  it("applies de-escalation immediately without confirm", () => {
    const off = gateProviderPermissionPatch(
      { alwaysApprove: true },
      { alwaysApprove: false }
    );
    assert.equal(off.kind, "apply");
    if (off.kind === "apply") {
      assert.equal(off.selection, "manual");
      assert.equal(off.flags.alwaysApprove, false);
    }

    const toPlan = gateProviderPermissionPatch(
      { alwaysApprove: true },
      { permissionMode: "plan" }
    );
    assert.equal(toPlan.kind, "apply");
    if (toPlan.kind === "apply") {
      assert.equal(toPlan.selection, "plan");
      assert.equal(toPlan.flags.alwaysApprove, false);
      assert.equal(toPlan.flags.permissionMode, "plan");
    }
  });

  it("applies safe / medium modes immediately", () => {
    for (const mode of ["default", "acceptEdits", "auto", "plan"] as const) {
      const r = gateProviderPermissionPatch({}, { permissionMode: mode });
      assert.equal(r.kind, "apply", mode);
    }
  });

  it("passthrough for non-permission flags", () => {
    assert.equal(
      gateProviderPermissionPatch({}, { model: "x", debug: true }).kind,
      "passthrough"
    );
  });

  it("does not re-confirm when already on the same high-risk mode", () => {
    const r = gateProviderPermissionPatch(
      { alwaysApprove: true },
      { alwaysApprove: true }
    );
    assert.equal(r.kind, "apply");
    if (r.kind === "apply") {
      assert.equal(r.selection, "always-approve");
    }
  });
});
