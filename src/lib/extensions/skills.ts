import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "fs";
import path from "path";
import type { ExtensionSource, SkillDescriptor } from "./types";
import {
  getUserSkillsRoot,
  projectAgentsSkillsDir,
} from "./paths";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export type ParsedSkillMd = {
  name?: string;
  description?: string;
  tags?: string[];
  body: string;
  frontmatterRaw?: string;
};

/** Parse YAML-ish frontmatter from SKILL.md (minimal, no full YAML dependency). */
export function parseSkillMarkdown(raw: string): ParsedSkillMd {
  const text = raw.replace(/^\uFEFF/, "");
  const m = text.match(FRONTMATTER_RE);
  if (!m) {
    return { body: text.trim(), description: firstParagraph(text) };
  }
  const fm = m[1];
  const body = (m[2] ?? "").trim();
  const fields = parseSimpleFrontmatter(fm);
  const tags = fields.tags
    ? fields.tags
        .split(/[,|]/)
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;
  return {
    name: fields.name?.trim() || undefined,
    description: fields.description?.trim() || firstParagraph(body),
    tags,
    body,
    frontmatterRaw: fm,
  };
}

function parseSimpleFrontmatter(fm: string): Record<string, string> {
  const out: Record<string, string> = {};
  let currentKey: string | null = null;
  let currentVal: string[] = [];

  const flush = () => {
    if (currentKey) {
      out[currentKey] = currentVal.join("\n").trim();
    }
    currentKey = null;
    currentVal = [];
  };

  for (const line of fm.split(/\r?\n/)) {
    // key: value
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (kv && !line.startsWith(" ") && !line.startsWith("\t")) {
      flush();
      currentKey = kv[1].toLowerCase();
      const v = kv[2].trim();
      // strip surrounding quotes
      currentVal = [
        v.replace(/^["']/, "").replace(/["']$/, "") || "",
      ];
      if (!v) currentVal = [];
      continue;
    }
    // continuation / folded description lines
    if (currentKey && (line.startsWith("  ") || line.startsWith("\t") || line.startsWith(">"))) {
      currentVal.push(line.trim());
      continue;
    }
    if (currentKey && line.trim() && !line.includes(":")) {
      currentVal.push(line.trim());
    }
  }
  flush();
  return out;
}

function firstParagraph(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("---"));
  const para = lines.slice(0, 3).join(" ").trim();
  return para.slice(0, 280);
}

function skillId(source: ExtensionSource, dirName: string, pluginId?: string): string {
  const base = `${source}:${dirName.toLowerCase()}`;
  return pluginId ? `plugin:${pluginId}:${dirName.toLowerCase()}` : base;
}

function readSkillFile(
  skillMdPath: string,
  opts: {
    source: ExtensionSource;
    enabled: boolean;
    pluginId?: string;
    loadBody?: boolean;
  }
): SkillDescriptor | null {
  if (!existsSync(skillMdPath)) return null;
  let st;
  try {
    st = statSync(skillMdPath);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }

  // Cap read for discovery (frontmatter + start of body)
  const maxBytes = opts.loadBody ? 256 * 1024 : 16 * 1024;
  let raw: string;
  try {
    const buf = readFileSync(skillMdPath);
    raw = buf.subarray(0, Math.min(buf.length, maxBytes)).toString("utf8");
  } catch {
    return null;
  }

  const parsed = parseSkillMarkdown(raw);
  const dir = path.dirname(skillMdPath);
  const dirName = path.basename(dir);
  const name = parsed.name || dirName;

  return {
    id: skillId(opts.source, dirName, opts.pluginId),
    name,
    description: parsed.description || "No description",
    path: skillMdPath,
    dir,
    source: opts.source,
    pluginId: opts.pluginId,
    tags: parsed.tags,
    enabled: opts.enabled,
    sizeBytes: st.size,
    frontmatterOnly: !opts.loadBody,
  };
}

/** Scan a skills root: either flat SKILL.md dirs or nested packages. */
export function discoverSkillsInRoot(
  root: string,
  source: ExtensionSource,
  opts?: {
    enabledMap?: Record<string, boolean>;
    pluginId?: string;
    loadBody?: boolean;
  }
): SkillDescriptor[] {
  if (!root || !existsSync(root)) return [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  const out: SkillDescriptor[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const full = path.join(root, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    // Convention: <root>/<name>/SKILL.md
    const skillMd = path.join(full, "SKILL.md");
    const alt = path.join(full, "skill.md");
    const file = existsSync(skillMd)
      ? skillMd
      : existsSync(alt)
        ? alt
        : null;
    if (!file) continue;

    const id = skillId(source, entry, opts?.pluginId);
    const enabled =
      opts?.enabledMap && id in opts.enabledMap
        ? opts.enabledMap[id] !== false
        : true;

    const skill = readSkillFile(file, {
      source,
      enabled,
      pluginId: opts?.pluginId,
      loadBody: opts?.loadBody,
    });
    if (skill) out.push(skill);
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function discoverProjectSkills(
  cwd: string | undefined,
  enabledMap?: Record<string, boolean>
): SkillDescriptor[] {
  if (!cwd?.trim()) return [];
  return discoverSkillsInRoot(projectAgentsSkillsDir(cwd), "project", {
    enabledMap,
  });
}

export function discoverUserSkills(
  enabledMap?: Record<string, boolean>
): SkillDescriptor[] {
  return discoverSkillsInRoot(getUserSkillsRoot(), "user", { enabledMap });
}

/** Load full skill body (capped) for preview / attach. */
export function loadSkillBody(
  skillPath: string,
  maxChars = 12_000
): { body: string; truncated: boolean; parsed: ParsedSkillMd } | null {
  if (!existsSync(skillPath)) return null;
  try {
    const raw = readFileSync(skillPath, "utf8");
    const parsed = parseSkillMarkdown(raw);
    const truncated = parsed.body.length > maxChars;
    return {
      body: truncated ? parsed.body.slice(0, maxChars) : parsed.body,
      truncated,
      parsed,
    };
  } catch {
    return null;
  }
}

export { buildSkillAttachmentSnippet } from "./format";