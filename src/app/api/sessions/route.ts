import {
  handleSessionsListGet,
  handleSessionsListPost,
} from "@/server/routes/sessions-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleSessionsListGet(req);
}

export async function POST(req: Request) {
  return handleSessionsListPost(req);
}
