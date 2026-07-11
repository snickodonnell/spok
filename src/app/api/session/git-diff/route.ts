import { handleGitDiffGet } from "@/server/routes/session-git-diff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGitDiffGet(req);
}
