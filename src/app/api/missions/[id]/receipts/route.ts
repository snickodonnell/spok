import {
  handleMissionReceiptsGet,
  handleMissionReceiptsPost,
} from "@/server/routes/mission-orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Context) {
  return handleMissionReceiptsGet(req, ctx);
}

export async function POST(req: Request, ctx: Context) {
  return handleMissionReceiptsPost(req, ctx);
}
