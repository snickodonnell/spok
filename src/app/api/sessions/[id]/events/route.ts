import {
  handleSessionEventsGet,
  handleSessionEventsPost,
} from "@/server/routes/sessions-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return handleSessionEventsGet(req, ctx);
}

export async function POST(req: Request, ctx: Ctx) {
  return handleSessionEventsPost(req, ctx);
}
