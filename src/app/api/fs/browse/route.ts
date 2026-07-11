import { handleFsBrowseGet } from "@/server/routes/fs-browse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleFsBrowseGet(req);
}
