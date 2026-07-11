import {
  handleApprovalsDelete,
  handleApprovalsGet,
  handleApprovalsPost,
} from "@/server/routes/approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleApprovalsGet(req);
}

export async function POST(req: Request) {
  return handleApprovalsPost(req);
}

export async function DELETE(req: Request) {
  return handleApprovalsDelete(req);
}
