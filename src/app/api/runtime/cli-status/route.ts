import { handleCliStatusGet } from "@/server/routes/cli-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleCliStatusGet(req);
}
