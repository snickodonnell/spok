/**
 * Soft heuristics for stream/log text that looks like a Grok auth failure.
 * Client-safe (no Node APIs). Never treats this as authoritative.
 *
 * Spok does not implement Grok login — users authenticate via the native CLI.
 */

export const CLI_AUTH_GUIDANCE =
  "Spok does not handle Grok login. Authenticate with the native Grok CLI in a terminal, then retry from Spok.";

export function detectAuthFailureHint(text: string): string | null {
  if (!text || text.length < 8) return null;
  const lower = text.toLowerCase();
  const patterns = [
    /not\s+authenticated/,
    /unauthori[sz]ed/,
    /authentication\s+required/,
    /please\s+(log|sign)\s*in/,
    /login\s+required/,
    /invalid\s+(api\s+)?token/,
    /api\s+key\s+(missing|invalid|required)/,
    /no\s+credentials/,
    /auth(?:entication)?\s+failed/,
    /session\s+expired/,
  ];
  for (const re of patterns) {
    if (re.test(lower)) {
      return CLI_AUTH_GUIDANCE;
    }
  }
  return null;
}
