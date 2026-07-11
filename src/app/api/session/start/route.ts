/**
 * Thin Next adapter — logic lives in src/server/routes/session-start.ts (PR1b).
 */
import {
  handleSessionStartDelete,
  handleSessionStartPost,
} from "@/server/routes/session-start";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleSessionStartPost(req);
}

export async function DELETE(req: Request) {
  return handleSessionStartDelete(req);
}
