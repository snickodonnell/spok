import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parsePorcelainStatus,
  primaryFileState,
  mapStatusChar,
  toDiffStatus,
} from "../../src/lib/git/porcelain";

describe("git porcelain parser", () => {
  it("maps status characters", () => {
    assert.equal(mapStatusChar("M"), "modified");
    assert.equal(mapStatusChar("A"), "added");
    assert.equal(mapStatusChar("D"), "deleted");
    assert.equal(mapStatusChar("R"), "renamed");
    assert.equal(mapStatusChar("?"), "untracked");
    assert.equal(mapStatusChar(" "), "unchanged");
  });

  it("parses modified staged and unstaged", () => {
    const entries = parsePorcelainStatus("MM src/app.ts\n M src/lib.ts\nM  src/ok.ts\n");
    assert.equal(entries.length, 3);

    const both = entries.find((e) => e.path === "src/app.ts");
    assert.ok(both);
    assert.deepEqual(both!.areas.sort(), ["staged", "unstaged"].sort());
    assert.equal(primaryFileState(both!), "modified");

    const unstagedOnly = entries.find((e) => e.path === "src/lib.ts");
    assert.ok(unstagedOnly);
    assert.deepEqual(unstagedOnly!.areas, ["unstaged"]);

    const stagedOnly = entries.find((e) => e.path === "src/ok.ts");
    assert.ok(stagedOnly);
    assert.deepEqual(stagedOnly!.areas, ["staged"]);
  });

  it("parses untracked and renames", () => {
    const entries = parsePorcelainStatus(
      '?? new-file.ts\nR  old.ts -> new.ts\n'
    );
    const ut = entries.find((e) => e.path === "new-file.ts");
    assert.ok(ut);
    assert.deepEqual(ut!.areas, ["untracked"]);
    assert.equal(ut!.indexStatus, "untracked");

    const ren = entries.find((e) => e.path === "new.ts");
    assert.ok(ren);
    assert.equal(ren!.oldPath, "old.ts");
    assert.equal(primaryFileState(ren!), "renamed");
    assert.equal(toDiffStatus("renamed"), "renamed");
  });

  it("detects conflict codes", () => {
    const entries = parsePorcelainStatus("UU conflicted.ts\n");
    assert.equal(entries[0].areas.includes("conflict"), true);
    assert.equal(primaryFileState(entries[0]), "unmerged");
  });

  it("handles quoted paths", () => {
    const entries = parsePorcelainStatus('?? "path with space.txt"\n');
    assert.equal(entries[0].path, "path with space.txt");
  });
});
