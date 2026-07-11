import fs from "fs";

const renames = [
  {
    file: "src/server/routes/session-git-diff.ts",
    map: {
      "export async function GET": "export async function handleGitDiffGet",
      "export async function POST": "export async function handleGitDiffPost",
    },
  },
  {
    file: "src/server/routes/sessions-id.ts",
    map: {
      "export async function GET": "export async function handleSessionIdGet",
      "export async function PUT": "export async function handleSessionIdPut",
      "export async function DELETE": "export async function handleSessionIdDelete",
    },
  },
  {
    file: "src/server/routes/sessions-events.ts",
    map: {
      "export async function GET": "export async function handleSessionEventsGet",
      "export async function POST": "export async function handleSessionEventsPost",
    },
  },
  {
    file: "src/server/routes/settings.ts",
    map: {
      "export async function GET": "export async function handleSettingsGet",
      "export async function PUT": "export async function handleSettingsPut",
      "export async function POST": "export async function handleSettingsPost",
    },
  },
  {
    file: "src/server/routes/approvals.ts",
    map: {
      "export async function GET": "export async function handleApprovalsGet",
      "export async function POST": "export async function handleApprovalsPost",
    },
  },
];

for (const r of renames) {
  if (!fs.existsSync(r.file)) {
    console.warn("skip missing", r.file);
    continue;
  }
  let t = fs.readFileSync(r.file, "utf8");
  t = t.replace(/export const runtime = "nodejs";\r?\n/g, "");
  t = t.replace(/export const dynamic = "force-dynamic";\r?\n/g, "");
  for (const [from, to] of Object.entries(r.map)) {
    if (!t.includes(from)) console.warn("missing", from, "in", r.file);
    t = t.split(from).join(to);
  }
  if (!t.startsWith("// Shared")) {
    t = "// Shared privileged handler (Track A extraction).\n" + t;
  }
  fs.writeFileSync(r.file, t);
  console.log("updated", r.file);
}
