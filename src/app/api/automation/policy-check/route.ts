import {
  authorizePrivilegedRequest,
  denyFromAuthorize,
  policyDenialResponse,
} from "@/lib/security/local-api";
import { evaluateAutomationCwdPolicy } from "@/lib/automation/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Check whether a cwd is allowed for automated jobs. */
export async function POST(req: Request) {
  const auth = authorizePrivilegedRequest(req, "automation_policy_check");
  if (!auth.ok) return denyFromAuthorize(auth);

  let body: {
    cwd?: string;
    requireTrusted?: boolean;
    isolate?: boolean;
    mainCheckout?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return policyDenialResponse(400, {
      error: "Invalid JSON",
      code: "forbidden",
      policy: "local_capability",
      action: "automation_policy_check",
    });
  }

  const decision = evaluateAutomationCwdPolicy({
    cwd: body.cwd ?? "",
    requireTrusted: body.requireTrusted,
    isolate: body.isolate,
    mainCheckout: body.mainCheckout,
  });

  return Response.json({ ...decision });
}
