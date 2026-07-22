/** OmniRoute-compatible Antigravity quota family (Gemini / Claude / other). */
export type AntigravityQuotaFamily = "gemini" | "claude" | "other";

export function getAntigravityQuotaFamily(
  labelOrId: string,
): AntigravityQuotaFamily {
  const normalized = labelOrId.trim().toLowerCase().replace(/^antigravity\//, "");
  const slash = normalized.indexOf("/");
  const bare = slash >= 0 ? normalized.slice(slash + 1) : normalized;

  if (
    bare.startsWith("gemini-") ||
    bare.includes("/gemini-") ||
    bare.includes("gemini")
  ) {
    return "gemini";
  }
  if (
    bare.startsWith("claude-") ||
    bare.startsWith("claude ") ||
    bare.startsWith("cloud-") ||
    bare.includes("/claude-") ||
    bare.includes("/cloud-") ||
    bare.includes("claude") ||
    bare.includes("anthropic")
  ) {
    return "claude";
  }
  return "other";
}
