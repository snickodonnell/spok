import {
  handleTrustDelete,
  handleTrustGet,
  handleTrustPost,
} from "@/server/routes/workspace-trust";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleTrustGet(req);
}

export async function POST(req: Request) {
  return handleTrustPost(req);
}

export async function DELETE(req: Request) {
  return handleTrustDelete(req);
}
