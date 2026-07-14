import { handleMissionSchedulePost } from "@/server/routes/mission-orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Context) {
  return handleMissionSchedulePost(req, ctx);
}
