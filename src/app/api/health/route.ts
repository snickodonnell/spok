export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    name: "spok",
    version: "0.1.0",
    time: Date.now(),
  });
}
