import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyFileRisk,
  fileRiskBadgeVariant,
  riskLevelRank,
} from "../../src/lib/file-risk";

describe("classifyFileRisk", () => {
  it("flags secrets and env files as security-critical", () => {
    const a = classifyFileRisk(".env");
    assert.equal(a.kind, "security");
    assert.equal(a.level, "critical");

    const b = classifyFileRisk("config/secrets/prod.yaml");
    assert.equal(b.kind, "security");

    const c = classifyFileRisk("certs/server.pem");
    assert.equal(c.kind, "security");

    const d = classifyFileRisk("src/app.ts", { isSecret: true } as never);
    assert.equal(d.kind, "security");
  });

  it("classifies config and CI paths", () => {
    assert.equal(classifyFileRisk("package.json").kind, "config");
    assert.equal(classifyFileRisk("tsconfig.json").kind, "config");
    assert.equal(classifyFileRisk(".github/workflows/ci.yml").kind, "config");
    assert.equal(classifyFileRisk("Dockerfile").kind, "config");
  });

  it("classifies generated lockfiles and build outputs", () => {
    assert.equal(classifyFileRisk("package-lock.json").kind, "generated");
    assert.equal(classifyFileRisk("pnpm-lock.yaml").kind, "generated");
    assert.equal(classifyFileRisk("dist/bundle.js").kind, "generated");
    assert.equal(classifyFileRisk(".next/server/app.js").kind, "generated");
  });

  it("classifies tests, docs, source, binary, large", () => {
    assert.equal(classifyFileRisk("src/foo.test.ts").kind, "test");
    assert.equal(classifyFileRisk("tests/harness/a.test.ts").kind, "test");
    assert.equal(classifyFileRisk("README.md").kind, "docs");
    assert.equal(classifyFileRisk("docs/guide.md").kind, "docs");
    assert.equal(classifyFileRisk("src/lib/store.ts").kind, "source");
    assert.equal(
      classifyFileRisk("assets/logo.png", { isBinary: true } as never).kind,
      "binary"
    );
    const large = classifyFileRisk("src/big.ts", {
      additions: 300,
      deletions: 200,
      hunks: [],
    } as never);
    assert.equal(large.kind, "large");
  });

  it("orders risk levels for queue sort", () => {
    assert.ok(riskLevelRank("critical") < riskLevelRank("high"));
    assert.ok(riskLevelRank("high") < riskLevelRank("medium"));
    assert.equal(fileRiskBadgeVariant("critical"), "error");
    assert.equal(fileRiskBadgeVariant("high"), "amber");
  });
});
