import {
  handleMissionIdGet,
  handleMissionIdPut,
} from "@/server/routes/missions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handleMissionIdGet;
export const PUT = handleMissionIdPut;
