import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { GROK_SLASH_COMMANDS } from "../../src/lib/grok-commands";
import {
  compareHelpToCatalog,
  exportCatalogFixture,
  parseGrokHelpCommands,
  verifyCatalogAgainstFixture,
  type SlashCatalogFixture,
} from "../../src/lib/slash-catalog";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(
  __dirname,
  "../fixtures/grok/slash-commands.fixture.json"
);

describe("slash command catalog fixture", () => {
  it("matches in-code GROK_SLASH_COMMANDS (regression gate)", () => {
    const raw = readFileSync(fixturePath, "utf8");
    const fixture = JSON.parse(raw) as SlashCatalogFixture;
    const diff = verifyCatalogAgainstFixture(fixture);
    assert.equal(
      diff.ok,
      true,
      `Catalog drift — update tests/fixtures/grok/slash-commands.fixture.json or code.\n${diff.summary}`
    );
    assert.equal(fixture.commands.length, GROK_SLASH_COMMANDS.length);
  });

  it("exportCatalogFixture round-trips names", () => {
    const exported = exportCatalogFixture({ source: "hand-maintained" });
    const diff = verifyCatalogAgainstFixture(exported);
    assert.equal(diff.ok, true);
  });

  it("parseGrokHelpCommands extracts Commands section", () => {
    const help = `
Usage: grok [options] [command]

Commands:
  agent       Run the coding agent
  login       Sign in
  mcp list    Manage MCP servers
  worktree    Isolated git worktree

Options:
  -h, --help  display help
`;
    const names = parseGrokHelpCommands(help);
    assert.ok(names.includes("agent"));
    assert.ok(names.includes("login"));
    assert.ok(names.includes("worktree"));
    assert.ok(names.includes("mcp") || names.includes("list"));
  });

  it("compareHelpToCatalog reports coverage gaps", () => {
    const help = `
Commands:
  login       Sign in
  totally-new-cmd   Future CLI feature
`;
    const cov = compareHelpToCatalog(help);
    assert.ok(cov.helpCommands.includes("login"));
    assert.ok(cov.uncoveredByCode.includes("totally-new-cmd"));
    // Spok-only commands should not be forced into help
    assert.ok(!cov.codeNotInHelp.includes("export"));
  });

  it("high-risk commands are marked in catalog", () => {
    const always = GROK_SLASH_COMMANDS.find((c) => c.name === "always-approve");
    assert.ok(always);
    assert.equal(always!.risk, "high");
  });
});
