import {
  handleMissionCheckpointGet,
  handleMissionCheckpointPost,
} from "@/server/routes/missions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handleMissionCheckpointGet;
export const POST = handleMissionCheckpointPost;
