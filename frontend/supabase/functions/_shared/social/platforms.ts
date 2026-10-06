// Platform rules shared by the edge functions (Deno) and the dashboard (Vite).
// Pure TypeScript only — no Deno or DOM APIs — so both runtimes can import it.

export type SocialPlatform = "linkedin" | "instagram" | "x" | "google_business";

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  "linkedin",
  "instagram",
  "x",
  "google_business",
] as const;

export interface PlatformSpec {
  id: SocialPlatform;
  label: string;
  /** Hard character limit enforced by the platform API. */
  maxChars: number;
  /** Whether a post must carry an image (Instagram feed posts do). */
  requiresImage: boolean;
  /** Recommended number of hashtags; more reads as spam on that network. */
  maxHashtags: number;
  /** MCP server (edge function) that owns this platform. */
  mcpServer: string;
  /** What the account represents, shown on the connect card. */
  accountNoun: string;
}

export const PLATFORM_SPECS: Record<SocialPlatform, PlatformSpec> = {
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    maxChars: 3000,
    requiresImage: false,
    maxHashtags: 5,
    mcpServer: "mcp-linkedin",
    accountNoun: "Company page",
  },
  instagram: {
    id: "instagram",
    label: "Instagram",
    maxChars: 2200,
    requiresImage: true,
    maxHashtags: 15,
    mcpServer: "mcp-instagram",
    accountNoun: "Business account",
  },
  x: {
    id: "x",
    label: "X (Twitter)",
    maxChars: 280,
    requiresImage: false,
    maxHashtags: 3,
    mcpServer: "mcp-x",
    accountNoun: "Account",
  },
  google_business: {
    id: "google_business",
    label: "Google Maps (Business Profile)",
    maxChars: 1500,
    requiresImage: false,
    maxHashtags: 0,
    mcpServer: "mcp-google-business",
    accountNoun: "Business location",
  },
};

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/**
 * X counts every URL as 23 characters regardless of length (t.co wrapping), and
 * counts most emoji as 2. This approximation keeps drafts under the real limit
 * instead of failing at publish time.
 */
export function platformLength(platform: SocialPlatform, text: string): number {
  if (platform !== "x") return [...text].length;
  const withoutUrls = text.replace(/https?:\/\/\S+/g, "x".repeat(23));
  let length = 0;
  for (const char of withoutUrls) {
    const code = char.codePointAt(0) ?? 0;
    length += code > 0xffff || (code >= 0x1100 && code <= 0x11ff) ? 2 : 1;
  }
  return length;
}

export function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export interface PlatformValidation {
  ok: boolean;
  length: number;
  maxChars: number;
  errors: string[];
  warnings: string[];
}

export function validateForPlatform(
  platform: SocialPlatform,
  text: string,
  options: { imageUrl?: string | null } = {},
): PlatformValidation {
  const spec = PLATFORM_SPECS[platform];
  const length = platformLength(platform, text);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!text.trim()) errors.push("Post is empty.");
  if (length > spec.maxChars) {
    errors.push(`${spec.label} allows ${spec.maxChars} characters; this post is ${length}.`);
  }
  if (spec.requiresImage && !options.imageUrl) {
    errors.push(`${spec.label} posts need an image.`);
  }
  const hashtags = countHashtags(text);
  if (spec.maxHashtags === 0 && hashtags > 0) {
    warnings.push(`${spec.label} does not use hashtags; they will appear as plain text.`);
  } else if (hashtags > spec.maxHashtags) {
    warnings.push(`${hashtags} hashtags — ${spec.label} works best with ${spec.maxHashtags} or fewer.`);
  }
  return { ok: errors.length === 0, length, maxChars: spec.maxChars, errors, warnings };
}

