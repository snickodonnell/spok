import {
  handleSessionIdDelete,
  handleSessionIdGet,
  handleSessionIdPut,
} from "@/server/routes/sessions-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return handleSessionIdGet(req, ctx);
}

export async function PUT(req: Request, ctx: Ctx) {
  return handleSessionIdPut(req, ctx);
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handleSessionIdDelete(req, ctx);
}
