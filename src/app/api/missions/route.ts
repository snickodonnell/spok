import {
  handleMissionsGet,
  handleMissionsPost,
} from "@/server/routes/missions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handleMissionsGet;
export const POST = handleMissionsPost;
