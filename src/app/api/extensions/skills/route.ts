import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
} from "@/lib/security/local-api";
import { discoverExtensions } from "@/lib/extensions/discover";
import { loadSkillBody } from "@/lib/extensions/skills";
import { isPathInsideRoot } from "@/lib/security/paths";
import { projectAgentsSkillsDir } from "@/lib/extensions/paths";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET skills, optionally load body for one skill.
 * ?cwd=&id=&body=1
 */
export async function GET(req: Request) {
  const auth = authorizePrivilegedRequest(req, "extensions_skills");
  if (!auth.ok) return denyFromAuthorize(auth);

  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd") || undefined;
  const id = searchParams.get("id");
  const wantBody = searchParams.get("body") === "1";

  const bundle = discoverExtensions(cwd);
  if (!id) {
    return Response.json({ skills: bundle.skills, roots: bundle.roots });
  }

  const skill = bundle.skills.find((s) => s.id === id);
  if (!skill) {
    return Response.json({ error: "Skill not found" }, { status: 404 });
  }

  // Path safety: skill file must live under known roots
  const allowedRoots = [
    bundle.roots.userSkills,
    bundle.roots.userPlugins,
    cwd ? projectAgentsSkillsDir(cwd) : null,
    cwd ? path.join(path.resolve(cwd), ".spok", "plugins") : null,
  ].filter(Boolean) as string[];

  const resolved = path.resolve(skill.path);
  const safe = allowedRoots.some((root) => isPathInsideRoot(resolved, root));
  // Also allow any skill path that was discovered (plugin roots vary)
  if (!safe && !bundle.skills.some((s) => path.resolve(s.path) === resolved)) {
    return Response.json({ error: "Skill path not allowed" }, { status: 403 });
  }

  if (!wantBody) {
    return Response.json({ skill });
  }

  const loaded = loadSkillBody(skill.path);
  if (!loaded) {
    return Response.json({ error: "Could not read skill" }, { status: 500 });
  }

  return Response.json({
    skill,
    body: loaded.body,
    truncated: loaded.truncated,
    name: loaded.parsed.name ?? skill.name,
    description: loaded.parsed.description ?? skill.description,
  });
}
