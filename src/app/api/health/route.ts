import { handleHealthGet } from "@/server/routes/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleHealthGet(req);
}
