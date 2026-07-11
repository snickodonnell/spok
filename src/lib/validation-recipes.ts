/**
 * One-click validation recipes for the Review / Validation workbench.
 * Produces composer prompts (and optional local shell hints) from session state.
 */

import { buildValidationLane, type ValidationItem } from "./validation-lane";
import type { Session } from "./types";

export type ValidationRecipeId =
  | "retest_failed"
  | "rerun_last_failed"
  | "test_touched"
  | "build_workspace"
  | "slash_catalog"
  | "review_security";

export interface ValidationRecipe {
  id: ValidationRecipeId;
  label: string;
  shortLabel: string;
  description: string;
  /** When false, UI disables the recipe. */
  available: boolean;
  /** Why unavailable (for tooltips). */
  unavailableReason?: string;
  /** Prompt text to prefill in the composer. */
  prompt: string;
  /** Optional shell one-liner for power users (display only). */
  shellHint?: string;
  /** Badge accent. */
  tone: "amber" | "cyan" | "green" | "magenta";
}

function lastFailed(items: ValidationItem[]): ValidationItem | undefined {
  return [...items]
    .reverse()
    .find(
      (i) =>
        (i.status === "failed" || i.status === "blocked") &&
        (i.kind === "test" ||
          i.kind === "build" ||
          i.kind === "command" ||
          i.kind === "tool" ||
          i.kind === "run" ||
          i.kind === "error")
    );
}

function lastFailedTest(items: ValidationItem[]): ValidationItem | undefined {
  return [...items]
    .reverse()
    .find((i) => i.status === "failed" && i.kind === "test");
}

function touchedPackages(session: Session): string[] {
  const pkgs = new Set<string>();
  for (const f of Object.values(session.files)) {
    const p = f.path.replace(/\\/g, "/");
    // monorepo-ish: packages/foo or apps/bar
    const m = p.match(/^(packages|apps|services|modules)\/([^/]+)/);
    if (m) {
      pkgs.add(`${m[1]}/${m[2]}`);
      continue;
    }
    // root package signals
    if (
      p === "package.json" ||
      p.startsWith("src/") ||
      p.startsWith("tests/") ||
      p.startsWith("e2e/")
    ) {
      pkgs.add(".");
    }
  }
  return [...pkgs].sort();
}

function securityPaths(session: Session): string[] {
  return Object.values(session.files)
    .filter((f) => f.isSecret)
    .map((f) => f.path)
    .slice(0, 12);
}

/**
 * Build the recipe catalog for the current session.
 */
export function buildValidationRecipes(session: Session): ValidationRecipe[] {
  const lane = buildValidationLane(session);
  const failed = lastFailed(lane.items);
  const failedTest = lastFailedTest(lane.items);
  const packages = touchedPackages(session);
  const secrets = securityPaths(session);
  const fileCount = Object.keys(session.files).length;

  const recipes: ValidationRecipe[] = [];

  // 1. Re-run last failed test
  {
    const cmd =
      failedTest?.command ||
      failedTest?.title ||
      failed?.command ||
      failed?.title;
    const available = !!failedTest || (!!failed && failed.kind === "test");
    recipes.push({
      id: "retest_failed",
      label: "Re-run failed tests",
      shortLabel: "Retest",
      description: available
        ? "Re-run the last failed test command from this session"
        : "No failed test in the validation lane yet",
      available,
      unavailableReason: available
        ? undefined
        : "Wait for a failed test, or run tests first",
      prompt: available
        ? [
            "Re-run the failed tests from this session and fix any remaining failures.",
            cmd ? `Last failed: \`${cmd}\`` : null,
            failedTest?.detail ? `Detail: ${failedTest.detail}` : null,
            "Report exit code and a short summary of what changed.",
          ]
            .filter(Boolean)
            .join("\n")
        : "",
      shellHint: failedTest?.command || failed?.command,
      tone: "amber",
    });
  }

  // 2. Re-run last failed command (any kind)
  {
    const available = !!failed;
    const cmd = failed?.command || failed?.title || "";
    recipes.push({
      id: "rerun_last_failed",
      label: "Re-run last failure",
      shortLabel: "Retry",
      description: available
        ? "Re-run the last failed command/tool"
        : "No failed command yet",
      available,
      unavailableReason: available ? undefined : "No failures in the validation lane",
      prompt: available
        ? [
            "Investigate and re-run the last failed command from this session.",
            cmd ? `Command: \`${cmd}\`` : null,
            failed?.detail ? `Detail: ${failed.detail}` : null,
            failed?.exitCode != null ? `Exit code: ${failed.exitCode}` : null,
            "Fix the root cause if needed, then re-run until it passes.",
          ]
            .filter(Boolean)
            .join("\n")
        : "",
      shellHint: failed?.command,
      tone: "amber",
    });
  }

  // 3. Test touched packages
  {
    const available = fileCount > 0;
    const pkgList =
      packages.length > 0
        ? packages.map((p) => "`" + p + "`").join(", ")
        : "the workspace root";
    let testDesc = "No file changes to scope tests";
    if (available) {
      testDesc =
        packages.length > 0
          ? `Run tests for: ${packages.join(", ")}`
          : "Run the project test suite for changed files";
    }
    const testPrompt = available
      ? [
          "Run the most relevant tests for the files changed in this session.",
          "Touched packages/areas: " + pkgList + ".",
          "Prefer package-scoped test scripts when available; fall back to the root test command.",
          "Summarize pass/fail with any remaining failures.",
        ].join("\n")
      : "";
    const testShell =
      packages.length === 1 && packages[0] !== "."
        ? "npm test --workspace=" + packages[0]
        : "npm test";
    recipes.push({
      id: "test_touched",
      label: "Test touched packages",
      shortLabel: "Test pkgs",
      description: testDesc,
      available,
      unavailableReason: available
        ? undefined
        : "No changed files in this session",
      prompt: testPrompt,
      shellHint: testShell,
      tone: "cyan",
    });
  }

  // 4. Build workspace
  {
    recipes.push({
      id: "build_workspace",
      label: "Build workspace",
      shortLabel: "Build",
      description: "Run the project build / typecheck",
      available: true,
      prompt: [
        "Build the current workspace and fix any compile or type errors.",
        "Use the project's standard build command (e.g. `npm run build`, `tsc`, cargo build).",
        "Report exit code and a concise list of remaining errors if any.",
      ].join("\n"),
      shellHint: "npm run build",
      tone: "green",
    });
  }

  // 5. Slash catalog check (Spok-specific dogfood)
  {
    recipes.push({
      id: "slash_catalog",
      label: "Slash catalog check",
      shortLabel: "Slash",
      description: "Verify Grok slash-command catalog fixture",
      available: true,
      prompt: [
        "Run the Spok slash catalog verification and fix any drift.",
        "Command: `npm run verify:slash-catalog`",
        "If it fails, update the fixture only when the CLI catalog intentionally changed, then re-run.",
      ].join("\n"),
      shellHint: "npm run verify:slash-catalog",
      tone: "magenta",
    });
  }

  // 6. Review security paths
  {
    const available = secrets.length > 0;
    recipes.push({
      id: "review_security",
      label: "Review secret paths",
      shortLabel: "Secrets",
      description: available
        ? `${secrets.length} secret-flagged path(s)`
        : "No secret-flagged paths in the diff",
      available,
      unavailableReason: available
        ? undefined
        : "No isSecret files in the current diff",
      prompt: available
        ? [
            "Review security-sensitive paths in this session. Do not print secret values.",
            "Paths:",
            ...secrets.map((p) => "- `" + p + "`"),
            "Confirm whether each change is intentional, suggest safer alternatives if credentials were staged, and recommend .gitignore / secret scanning if needed.",
          ].join("\n")
        : "",
      tone: "amber",
    });
  }

  return recipes;
}
