import {
  handleAutomationJobsGet,
  handleAutomationJobsPost,
  handleAutomationJobsPut,
} from "@/server/routes/automation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handleAutomationJobsGet;
export const POST = handleAutomationJobsPost;
export const PUT = handleAutomationJobsPut;
