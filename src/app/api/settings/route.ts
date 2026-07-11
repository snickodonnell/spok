import {
  handleSettingsGet,
  handleSettingsPut,
} from "@/server/routes/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleSettingsGet(req);
}

export async function PUT(req: Request) {
  return handleSettingsPut(req);
}
