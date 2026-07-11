import { handleGitGet, handleGitPost } from "@/server/routes/session-git";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGitGet(req);
}

export async function POST(req: Request) {
  return handleGitPost(req);
}
