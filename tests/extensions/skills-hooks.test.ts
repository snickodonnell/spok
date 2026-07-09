import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseSkillMarkdown,
  discoverSkillsInRoot,
  loadSkillBody,
} from "../../src/lib/extensions/skills";
import {
  buildSkillAttachmentSnippet,
  buildAgentBrief,
} from "../../src/lib/extensions/format";
import {
  applyHookTemplate,
  builtinHooks,
  mergeHooks,
  runHooks,
  sanitizeHook,
} from "../../src/lib/extensions/hooks";
import {
  parsePluginManifest,
  expandPluginContributions,
} from "../../src/lib/extensions/plugins";
import { sanitizeAgent, mergeAgents, builtinAgents } from "../../src/lib/extensions/agents";
import {
  emptyExtensionPreferences,
  type ExtensionPreferences,
  type SkillDescriptor,
} from "../../src/lib/extensions/types";
import { defaultSettings } from "../../src/lib/settings/defaults";
import {
  patchPreferences,
  sanitizePartialPreferences,
  sanitizePreferences,
} from "../../src/lib/extensions/preferences";
import {
  listMcpToolsReadOnly,
  mergeMcpServers,
  sanitizeMcpServer,
} from "../../src/lib/extensions/mcp";

describe("skill markdown parse", () => {
  it("parses YAML frontmatter name and description", () => {
    const raw = `---
name: spok-secure-runtime
description: Use when implementing secure runtime boundaries.
tags: security, runtime
---

# Secure Runtime

Body content here.
`;
    const parsed = parseSkillMarkdown(raw);
    assert.equal(parsed.name, "spok-secure-runtime");
    assert.match(parsed.description || "", /secure runtime/i);
    assert.ok(parsed.tags?.includes("security"));
    assert.match(parsed.body, /Body content/);
  });

  it("falls back without frontmatter", () => {
    const parsed = parseSkillMarkdown("# Hello\n\nFirst paragraph for description.");
    assert.equal(parsed.name, undefined);
    assert.match(parsed.description || "", /First paragraph/);
  });
});

describe("skill discovery", () => {
  let root: string;

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "spok-skills-"));
    const skillDir = path.join(root, "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: demo-skill
description: A tiny demo skill for tests.
---

Guide the agent carefully.
`,
      "utf8"
    );
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("discovers SKILL.md packages", () => {
    const skills = discoverSkillsInRoot(root, "project");
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "demo-skill");
    assert.equal(skills[0].source, "project");
    assert.match(skills[0].id, /demo-skill/);
  });

  it("loads body on demand", () => {
    const skills = discoverSkillsInRoot(root, "project");
    const body = loadSkillBody(skills[0].path);
    assert.ok(body);
    assert.match(body.body, /Guide the agent/);
  });

  it("buildSkillAttachmentSnippet stays compact", () => {
    const skills: SkillDescriptor[] = [
      {
        id: "project:demo-skill",
        name: "demo-skill",
        description: "A tiny demo skill for tests.",
        path: "/tmp/demo/SKILL.md",
        dir: "/tmp/demo",
        source: "project",
        enabled: true,
      },
    ];
    const snippet = buildSkillAttachmentSnippet(skills);
    assert.match(snippet, /Attached Spok skills/);
    assert.match(snippet, /demo-skill/);
    assert.ok(snippet.length < 800);
  });
});

describe("hooks", () => {
  it("sanitizes and templates trace hooks", () => {
    const hook = sanitizeHook(
      {
        id: "h1",
        name: "Stop note",
        events: ["stop"],
        kind: "trace",
        message: "done {{event}} sid={{sessionId}}",
      },
      { source: "user", trust: "trusted" }
    );
    assert.ok(hook);
    assert.equal(
      applyHookTemplate(hook!.message!, {
        event: "stop",
        sessionId: "abc",
        cwd: "/repo",
      }),
      "done stop sid=abc"
    );
  });

  it("skips untrusted hooks and runs trusted trace hooks", async () => {
    const prefs = emptyExtensionPreferences();
    const hooks = mergeHooks({
      builtin: builtinHooks(),
      user: [],
      project: [
        sanitizeHook(
          {
            id: "project:untrusted",
            name: "Untrusted project hook",
            events: ["stop"],
            kind: "trace",
            message: "should not run",
          },
          { source: "project", trust: "untrusted" }
        )!,
      ],
      plugin: [],
      prefs,
    });

    const results = await runHooks(
      { event: "stop", sessionId: "sess-1", cwd: "/tmp" },
      hooks,
      defaultSettings()
    );

    const untrusted = results.find((r) => r.hookId === "project:untrusted");
    assert.ok(untrusted?.skipped);
    assert.match(untrusted?.reason || "", /trust review/i);

    const builtin = results.find((r) => r.hookId === "builtin:stop-trace");
    assert.ok(builtin);
    assert.equal(builtin!.ok, true);
    assert.equal(builtin!.events.length, 1);
    assert.equal(builtin!.events[0].type, "system");
    assert.match(builtin!.events[0].content, /stop/);
  });

  it("builtin stop hook fires on stop (not session_end alone)", async () => {
    const onStop = await runHooks(
      { event: "stop", sessionId: "s2", cwd: "C:\\dev\\spok" },
      builtinHooks(),
      defaultSettings()
    );
    assert.equal(onStop.length, 1);
    assert.equal(onStop[0].ok, true);
    assert.match(onStop[0].events[0].title, /Stop breadcrumb|Hook/);

    const onEnd = await runHooks(
      { event: "session_end", sessionId: "s2", cwd: "C:\\dev\\spok" },
      builtinHooks(),
      defaultSettings()
    );
    assert.equal(onEnd.length, 0);
  });
});

describe("mcp registry", () => {
  it("lists declared tools with approval state", () => {
    const server = sanitizeMcpServer(
      {
        id: "fs",
        name: "Filesystem",
        transport: "stdio",
        command: "npx",
        tools: [{ name: "read_file", description: "Read a file" }],
      },
      { source: "user", trust: "trusted" }
    );
    assert.ok(server);
    const tools = listMcpToolsReadOnly([server!], defaultSettings());
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "read_file");
    assert.ok(["ask", "allow", "deny"].includes(tools[0].approval));
  });

  it("marks untrusted server tools as untrusted", () => {
    const server = sanitizeMcpServer(
      {
        id: "evil",
        name: "Evil",
        tools: [{ name: "run" }],
      },
      { source: "project", trust: "untrusted" }
    )!;
    const tools = listMcpToolsReadOnly([server], defaultSettings());
    assert.equal(tools[0].approval, "untrusted");
  });

  it("merges preference trust overrides", () => {
    const prefs: ExtensionPreferences = {
      ...emptyExtensionPreferences(),
      mcp: { proj: { trust: "trusted", enabled: true } },
    };
    const servers = mergeMcpServers({
      user: [],
      project: [
        sanitizeMcpServer(
          { id: "proj", name: "Project MCP", tools: [{ name: "t" }] },
          { source: "project", trust: "untrusted" }
        )!,
      ],
      plugin: [],
      prefs,
    });
    assert.equal(servers[0].trust, "trusted");
  });
});

describe("plugins and agents", () => {
  it("parses plugin manifest draft", () => {
    const m = parsePluginManifest({
      id: "demo-plugin",
      name: "Demo Plugin",
      version: "1.0.0",
      description: "Packaged skills + hooks",
      skills: [".agents/skills"],
      hooks: [
        {
          name: "On stop",
          events: ["stop"],
          kind: "trace",
          message: "plugin stop",
        },
      ],
      agents: [{ name: "Reviewer", permissionMode: "plan" }],
    });
    assert.ok(m);
    assert.equal(m!.schema, "spok.plugin/v1");
    assert.equal(m!.hooks?.length, 1);
  });

  it("expands trusted plugin contributions", () => {
    const root = mkdtempSync(path.join(tmpdir(), "spok-plugin-"));
    try {
      const pluginDir = path.join(root, "pack");
      const skillDir = path.join(pluginDir, "skills", "pack-skill");
      mkdirSync(skillDir, { recursive: true });
      const manifestJson = {
        id: "pack",
        name: "Pack",
        version: "0.1.0",
        skills: ["skills"],
        mcp: [
          {
            name: "pack-mcp",
            transport: "stdio",
            command: "echo",
            tools: [{ name: "ping" }],
          },
        ],
      };
      writeFileSync(
        path.join(pluginDir, "spok.plugin.json"),
        JSON.stringify(manifestJson),
        "utf8"
      );
      writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: pack-skill\ndescription: From plugin\n---\n\nHi\n",
        "utf8"
      );

      const prefs = emptyExtensionPreferences();
      prefs.plugins.pack = { trust: "trusted", enabled: true };
      const manifest = parsePluginManifest(manifestJson)!;
      const plugins = [
        {
          id: "pack",
          name: "Pack",
          version: "0.1.0",
          path: pluginDir,
          manifestPath: path.join(pluginDir, "spok.plugin.json"),
          source: "user" as const,
          enabled: true,
          trust: "trusted" as const,
          skillCount: 1,
          mcpCount: 1,
          hookCount: 0,
          agentCount: 0,
          commandCount: 0,
          manifest,
        },
      ];
      const bits = expandPluginContributions(plugins, prefs);
      assert.ok(bits.skills.some((s) => s.name === "pack-skill"));
      assert.ok(bits.mcp.some((m) => m.name === "pack-mcp" || m.id.includes("pack")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges builtin agents and builds brief", () => {
    const agents = mergeAgents({
      builtin: builtinAgents(),
      project: [],
      plugin: [],
      prefs: emptyExtensionPreferences(),
    });
    assert.ok(agents.some((a) => a.id === "builtin:explorer"));
    const explorer = agents.find((a) => a.id === "builtin:explorer")!;
    const brief = buildAgentBrief(explorer);
    assert.match(brief, /Explorer/);
    assert.match(brief, /plan/);
  });

  it("sanitizes custom agent", () => {
    const a = sanitizeAgent(
      {
        name: "My Reviewer",
        permissionMode: "plan",
        worktreeIsolation: true,
        tools: ["read", "grep"],
      },
      { source: "user" }
    );
    assert.ok(a);
    assert.equal(a!.permissionMode, "plan");
    assert.equal(a!.worktreeIsolation, true);
  });
});

describe("extension preferences patch", () => {
  it("does not wipe agents when patching hooks trust", () => {
    const current = sanitizePreferences({
      agents: [
        {
          id: "user:a",
          name: "A",
          source: "user",
          enabled: true,
        },
      ],
      userHooks: [
        {
          id: "user:h",
          name: "H",
          events: ["stop"],
          kind: "trace",
          enabled: true,
          source: "user",
          trust: "trusted",
        },
      ],
    });
    const next = patchPreferences(
      current,
      sanitizePartialPreferences({
        hooks: { "project:x": { trust: "trusted" } },
      })
    );
    assert.equal(next.agents.length, 1);
    assert.equal(next.userHooks.length, 1);
    assert.equal(next.hooks["project:x"]?.trust, "trusted");
  });
});
