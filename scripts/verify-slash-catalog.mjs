/**
 * Verify in-code slash catalog against checked fixture.
 * Usage: node scripts/verify-slash-catalog.mjs
 * Exit 0 on match, 1 on drift (print how to update fixture).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const fixturePath = join(
  root,
  "tests/fixtures/grok/slash-commands.fixture.json"
);

// Load compiled-free TS via tsx if available, else expect JSON-only path
const require = createRequire(import.meta.url);

async function main() {
  const write = process.argv.includes("--write");
  // Dynamic import through tsx runner is preferred: npm run test covers this.
  // This script re-validates by spawning tsx when present.
  const { register } = await import("node:module").catch(() => ({ register: null }));
  void register;

  // Inline: parse fixture and compare names list via grepping source is fragile.
  // Prefer: node --import tsx scripts/... — document in package.json.
  const { GROK_SLASH_COMMANDS } = await import(
    "../src/lib/grok-commands.ts"
  ).catch(async () => {
    // Fallback when plain node cannot load TS
    console.error(
      "Run with: npx tsx scripts/verify-slash-catalog.mjs\n" +
        "Or use npm test (slash-catalog suite)."
    );
    process.exit(2);
  });
  const {
    exportCatalogFixture,
    verifyCatalogAgainstFixture,
  } = await import("../src/lib/slash-catalog.ts");

  if (write) {
    const fixture = exportCatalogFixture({ source: "hand-maintained" });
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n", "utf8");
    console.log(`Wrote ${fixturePath} (${fixture.commands.length} commands)`);
    process.exit(0);
  }

  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const diff = verifyCatalogAgainstFixture(fixture, GROK_SLASH_COMMANDS);
  if (diff.ok) {
    console.log(`OK: ${diff.summary} (${GROK_SLASH_COMMANDS.length} commands)`);
    process.exit(0);
  }
  console.error(`FAIL: ${diff.summary}`);
  console.error("Update fixture: npx tsx scripts/verify-slash-catalog.mjs --write");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
