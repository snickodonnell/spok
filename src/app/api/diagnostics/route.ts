import { handleDiagnosticsGet } from "@/server/routes/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleDiagnosticsGet(req);
}
