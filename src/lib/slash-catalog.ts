/**
 * Slash-command catalog verification against a checked fixture.
 * Live `grok --help` can be parsed and compared; fixture is the regression gate.
 */

import {
  GROK_SLASH_COMMANDS,
  type SlashCommand,
  type SlashKind,
} from "./grok-commands";

export type SlashCatalogFixtureEntry = {
  name: string;
  aliases?: string[];
  kind: SlashKind;
  group: SlashCommand["group"];
  risk?: SlashCommand["risk"];
};

export type SlashCatalogFixture = {
  version: number;
  /** How the catalog was produced */
  source: "hand-maintained" | "grok-help" | "mixed";
  /** Optional CLI version string when fixture was generated */
  cliVersion?: string | null;
  updatedAt: string;
  commands: SlashCatalogFixtureEntry[];
};

export type CatalogDiff = {
  ok: boolean;
  missingInCode: string[];
  missingInFixture: string[];
  kindMismatches: Array<{ name: string; fixture: string; code: string }>;
  groupMismatches: Array<{ name: string; fixture: string; code: string }>;
  summary: string;
};

/** Snapshot of in-code catalog suitable for writing a fixture. */
export function exportCatalogFixture(
  opts?: Partial<Pick<SlashCatalogFixture, "source" | "cliVersion">>
): SlashCatalogFixture {
  return {
    version: 1,
    source: opts?.source ?? "hand-maintained",
    cliVersion: opts?.cliVersion ?? null,
    updatedAt: new Date().toISOString().slice(0, 10),
    commands: GROK_SLASH_COMMANDS.map((c) => ({
      name: c.name,
      aliases: c.aliases,
      kind: c.kind,
      group: c.group,
      risk: c.risk,
    })),
  };
}

export function verifyCatalogAgainstFixture(
  fixture: SlashCatalogFixture,
  code: SlashCommand[] = GROK_SLASH_COMMANDS
): CatalogDiff {
  const fixtureNames = new Set(fixture.commands.map((c) => c.name));
  const codeByName = new Map(code.map((c) => [c.name, c]));
  const codeNames = new Set(code.map((c) => c.name));

  const missingInCode = [...fixtureNames].filter((n) => !codeNames.has(n)).sort();
  const missingInFixture = [...codeNames]
    .filter((n) => !fixtureNames.has(n))
    .sort();

  const kindMismatches: CatalogDiff["kindMismatches"] = [];
  const groupMismatches: CatalogDiff["groupMismatches"] = [];

  for (const fc of fixture.commands) {
    const cc = codeByName.get(fc.name);
    if (!cc) continue;
    if (fc.kind !== cc.kind) {
      kindMismatches.push({
        name: fc.name,
        fixture: fc.kind,
        code: cc.kind,
      });
    }
    if (fc.group !== cc.group) {
      groupMismatches.push({
        name: fc.name,
        fixture: fc.group,
        code: cc.group,
      });
    }
  }

  const ok =
    missingInCode.length === 0 &&
    missingInFixture.length === 0 &&
    kindMismatches.length === 0 &&
    groupMismatches.length === 0;

  const parts: string[] = [];
  if (missingInCode.length)
    parts.push(`fixture-only: ${missingInCode.join(", ")}`);
  if (missingInFixture.length)
    parts.push(`code-only: ${missingInFixture.join(", ")}`);
  if (kindMismatches.length)
    parts.push(
      `kind: ${kindMismatches.map((m) => m.name).join(", ")}`
    );
  if (groupMismatches.length)
    parts.push(
      `group: ${groupMismatches.map((m) => m.name).join(", ")}`
    );

  return {
    ok,
    missingInCode,
    missingInFixture,
    kindMismatches,
    groupMismatches,
    summary: ok ? "catalog matches fixture" : parts.join("; "),
  };
}

/**
 * Parse `grok --help` / subcommand help text for top-level command tokens.
 * Handles common CLI help shapes (Commands: section, "  name  desc" lines).
 */
export function parseGrokHelpCommands(helpText: string): string[] {
  const names = new Set<string>();
  const lines = helpText.split(/\r?\n/);
  let inCommands = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^commands?:?\s*$/i.test(trimmed) || /^available commands/i.test(trimmed)) {
      inCommands = true;
      continue;
    }
    if (inCommands && /^[A-Z][a-z].*:?\s*$/.test(trimmed) && !trimmed.includes("  ")) {
      // New section heading
      if (!/command/i.test(trimmed)) inCommands = false;
      continue;
    }

    // "  name, alias    Description" or "  name    Description" or "  mcp list  …"
    const m = line.match(
      /^\s{2,}([a-z][\w-]*)(?:[,\s]+[a-z][\w-]*)*?\s{2,}\S/i
    );
    if (m) {
      names.add(m[1].toLowerCase());
      continue;
    }
    // Fallback: indented token then long spaces
    const m2 = line.match(/^\s{2,}([a-z][\w-]*)\b/i);
    if (m2 && inCommands && line.length > m2[0].length + 2) {
      names.add(m2[1].toLowerCase());
      continue;
    }

    // Bullet style: "- name: description"
    const b = trimmed.match(/^[-*]\s+([a-z][\w-]*)\b/i);
    if (b && inCommands) {
      names.add(b[1].toLowerCase());
    }
  }

  // Also pick explicit "/name" mentions (slash UX docs)
  for (const m of helpText.matchAll(/(?:^|\s)\/([a-z][\w-]*)\b/gi)) {
    names.add(m[1].toLowerCase());
  }

  return [...names].sort();
}

export type HelpCoverage = {
  helpCommands: string[];
  /** Help names that have no matching code command or alias */
  uncoveredByCode: string[];
  /** Code commands that never appear in help (Spok-only ok) */
  codeNotInHelp: string[];
  /** Help tokens that are likely Spok-only or noise */
  ignored: string[];
};

const HELP_NOISE = new Set([
  "help",
  "version",
  "options",
  "usage",
  "commands",
  "examples",
  "flags",
]);

/**
 * Compare help-parsed names against the in-code catalog.
 * Spok-only UI commands (export, clear, stop) are expected to be code-only.
 */
export function compareHelpToCatalog(
  helpText: string,
  code: SlashCommand[] = GROK_SLASH_COMMANDS
): HelpCoverage {
  const helpCommands = parseGrokHelpCommands(helpText).filter(
    (n) => !HELP_NOISE.has(n)
  );
  const codeNames = new Set(code.map((c) => c.name));
  const aliasToName = new Map<string, string>();
  for (const c of code) {
    aliasToName.set(c.name, c.name);
    for (const a of c.aliases ?? []) aliasToName.set(a.toLowerCase(), c.name);
  }

  const SPOK_ONLY = new Set(
    code.filter((c) => c.group === "spok").map((c) => c.name)
  );

  const uncoveredByCode = helpCommands.filter((h) => !aliasToName.has(h));
  const codeNotInHelp = [...codeNames].filter(
    (n) => !helpCommands.includes(n) && !SPOK_ONLY.has(n)
  );
  const ignored = helpCommands.filter((h) => HELP_NOISE.has(h));

  return {
    helpCommands,
    uncoveredByCode: uncoveredByCode.sort(),
    codeNotInHelp: codeNotInHelp.sort(),
    ignored,
  };
}
