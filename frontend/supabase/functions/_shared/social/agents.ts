// Agent definitions, prompt construction, factual guardrails and the template
// fallback used when Claude is not configured. Pure TypeScript (Deno + Vite).

import { PLATFORM_SPECS, type SocialPlatform, validateForPlatform } from "./platforms.ts";

export type AgentId =
  | "community-alert"
  | "perishable-dispatch"
  | "partner-relay"
  | "donor-gratitude"
  | "community-inbox";

export type AgentTone = "community" | "urgent" | "partner" | "storyteller" | "helpful";

export type AgentTrigger = "manual" | "rescue_accepted" | "rescue_delivered" | "urgent_surplus" | "inbox_sweep";

export interface AgentDefinition {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  tone: AgentTone;
  /** Platforms this agent writes for by default. */
  defaultPlatforms: SocialPlatform[];
  defaultSignoff: string;
  /** Inbox agents read comments/reviews and draft replies instead of posts. */
  kind: "broadcast" | "inbox";
  brief: string;
}

export const AGENT_DEFINITIONS: Record<AgentId, AgentDefinition> = {
  "community-alert": {
    id: "community-alert",
    name: "Community Food Alert Agent",
    role: "Public distribution announcements",
    description:
      "Alerts local residents, neighborhood groups, and families when fresh or prepared surplus arrives for free distribution.",
    tone: "community",
    defaultPlatforms: ["instagram", "google_business", "x"],
    defaultSignoff: "All are welcome. No ID or paperwork required. First-come, first-served.",
    kind: "broadcast",
    brief:
      "Tell neighbors that free food is available: what it is, where, until when, how it must be stored, and allergens. Warm, plain language at a 6th-grade reading level. Never stigmatize need.",
  },
  "perishable-dispatch": {
    id: "perishable-dispatch",
    name: "Urgent Surplus Alert Bot",
    role: "Time-critical perishables broadcast",
    description:
      "Triggers instant alerts when high-value refrigerated items or prepared meals need to be claimed within 3 hours.",
    tone: "urgent",
    defaultPlatforms: ["x", "google_business"],
    defaultSignoff: "Please bring your own cold-totes or containers if possible!",
    kind: "broadcast",
    brief:
      "Short, scannable, urgent. Lead with quantity and deadline. Ask pantries, shelters and volunteers with capacity to claim it in RescueRelay. No alarmism about food safety — it is safe, just time-sensitive.",
  },
  "partner-relay": {
    id: "partner-relay",
    name: "Sister Pantry & Shelter Dispatcher",
    role: "B2B cross-pantry collaboration",
    description:
      "Informs nearby soup kitchens, youth shelters, and mutual aid partners when donations exceed on-site cold storage capacity.",
    tone: "partner",
    defaultPlatforms: ["linkedin"],
    defaultSignoff: "Cross-docking and volunteer pickup assistance available on request.",
    kind: "broadcast",
    brief:
      "Professional update for partner organizations, funders and other nonprofits: logistics, capacity, and how to coordinate. No emoji walls.",
  },
  "donor-gratitude": {
    id: "donor-gratitude",
    name: "Donor Impact & Gratitude Agent",
    role: "Public recognition & meal impact",
    description:
      "Celebrates donors, shares verified rescued meal counts, and inspires local grocers and restaurants to join RescueRelay.",
    tone: "storyteller",
    defaultPlatforms: ["linkedin", "instagram"],
    defaultSignoff: "Together, we make sure good food reaches tables instead of landfills.",
    kind: "broadcast",
    brief:
      "Thank the donor by name when provided, state verified impact (pounds and estimated meals from the record only), and invite other businesses to donate surplus.",
  },
  "community-inbox": {
    id: "community-inbox",
    name: "Community Inbox Agent",
    role: "Comments, mentions & Google reviews",
    description:
      "Reads new comments, mentions and Google Maps reviews across connected accounts and drafts friendly, accurate replies for approval.",
    tone: "helpful",
    defaultPlatforms: ["instagram", "x", "linkedin", "google_business"],
    defaultSignoff: "",
    kind: "inbox",
    brief:
      "Answer questions about hours, location and eligibility using only the organization facts provided. Thank people for kind words. For complaints, apologize briefly and invite them to contact the organization directly. Never argue, never share anyone's personal details, never promise food that is not listed.",
  },
};

export const AGENT_IDS = Object.keys(AGENT_DEFINITIONS) as AgentId[];

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && value in AGENT_DEFINITIONS;
}

/** Which agent handles each automatic trigger. */
export const TRIGGER_AGENT: Record<Exclude<AgentTrigger, "manual">, AgentId> = {
  rescue_accepted: "community-alert",
  rescue_delivered: "donor-gratitude",
  urgent_surplus: "perishable-dispatch",
  inbox_sweep: "community-inbox",
};

export interface RescueFacts {
  id: string;
  title: string;
  category: string;
  pounds: number;
  servings?: number | null;
  pickupAddress: string;
  pickupDeadline: string; // ISO
  storage: "ambient" | "refrigerated" | "frozen" | string;
  allergens: string;
  notes: string;
  status: string;
  donorName?: string | null;
  recipientName?: string | null;
  recipientAddress?: string | null;
}

export interface OrganizationFacts {
  name: string;
  address: string;
  phone?: string;
  website?: string;
  hoursNote?: string;
  city?: string;
}

export interface AgentSettings {
  tone?: AgentTone;
  signoff?: string;
  extraInstructions?: string;
}

/** USDA/Feeding America convention: ~1.2 lb of food per meal. */
export function estimateMeals(pounds: number, servings?: number | null): number {
  if (servings && servings > 0) return servings;
  return Math.max(1, Math.round(pounds / 1.2));
}

export function formatDeadline(iso: string, timeZone = "America/Chicago"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function storageLabel(storage: string): string {
  if (storage === "refrigerated") return "Keep refrigerated";
  if (storage === "frozen") return "Keep frozen";
  return "Shelf-stable";
}

export function buildSystemPrompt(agent: AgentDefinition, org: OrganizationFacts, settings: AgentSettings = {}): string {
  const tone = settings.tone ?? agent.tone;
  const signoff = settings.signoff ?? agent.defaultSignoff;
  return [
    `You are the "${agent.name}" for ${org.name}, a food rescue partner on RescueRelay.`,
    `Your job: ${agent.brief}`,
    `Tone: ${tone}.`,
    "",
    "Hard rules — a post that breaks any of these will be rejected automatically:",
    "1. Use ONLY facts given in the RESCUE and ORGANIZATION blocks. Never invent quantities, times, addresses, names, phone numbers, or eligibility rules.",
    "2. Any weight you mention must be exactly the pounds in the record. Meal counts must be the estimated meals given.",
    "3. Food posts for the public must state the storage requirement and list allergens if any are given.",
    "4. Never include personal information about drivers, recipients or individual community members.",
    "5. Respect each platform's character limit and culture (LinkedIn: professional; Instagram: visual, a few hashtags; X: one tight message; Google Business Profile: plain, no hashtags).",
    signoff ? `6. End public posts with this sign-off when it fits: "${signoff}"` : "",
    settings.extraInstructions ? `\nOrganization's extra instructions: ${settings.extraInstructions}` : "",
    "",
    "When you have written each draft, call the save_draft tool once per platform. Do not output the post as plain text.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildRescueBlock(rescue: RescueFacts, org: OrganizationFacts): string {
  const meals = estimateMeals(rescue.pounds, rescue.servings);
  return [
    "RESCUE",
    `- Item: ${rescue.title} (${rescue.category})`,
    `- Weight: ${rescue.pounds} lb`,
    `- Estimated meals: ${meals}`,
    `- Storage: ${storageLabel(rescue.storage)}`,
    `- Allergens: ${rescue.allergens.trim() || "none listed"}`,
    `- Pickup address: ${rescue.pickupAddress}`,
    `- Claim/pickup deadline: ${formatDeadline(rescue.pickupDeadline)}`,
    `- Status: ${rescue.status}`,
    rescue.donorName ? `- Donor: ${rescue.donorName}` : "",
    rescue.recipientName ? `- Receiving organization: ${rescue.recipientName}` : "",
    rescue.recipientAddress ? `- Distribution address: ${rescue.recipientAddress}` : "",
    rescue.notes.trim() ? `- Notes from donor: ${rescue.notes.trim()}` : "",
    "",
    buildOrgBlock(org),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildOrgBlock(org: OrganizationFacts): string {
  return [
    "ORGANIZATION",
    `- Name: ${org.name}`,
    `- Address: ${org.address}`,
    org.phone ? `- Phone: ${org.phone}` : "",
    org.website ? `- Website: ${org.website}` : "",
    org.hoursNote ? `- Hours: ${org.hoursNote}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface GuardrailResult {
  ok: boolean;
  problems: string[];
}

/**
 * Deterministic fact checks run on every AI draft before it is saved. They are
 * deliberately narrow: they catch the failure modes that would actually hurt a
 * food bank (wrong quantity, missing allergen warning, over-limit post) without
 * second-guessing style.
 */
export function checkDraft(
  draft: { platform: SocialPlatform; content: string; imageUrl?: string | null },
  context: { agent: AgentDefinition; rescue?: RescueFacts | null; isReply?: boolean },
): GuardrailResult {
  const problems: string[] = [];
  const validation = validateForPlatform(draft.platform, draft.content, {
    imageUrl: context.isReply ? "reply" : draft.imageUrl ?? null,
  });
  problems.push(...validation.errors);

  const rescue = context.rescue;
  if (rescue && !context.isReply) {
    const text = draft.content.toLowerCase();
    const weights = [...draft.content.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:lb|lbs|pounds?)\b/gi)].map((m) =>
      Number(m[1]!.replace(/,/g, "")),
    );
    for (const weight of weights) {
      if (Math.abs(weight - rescue.pounds) > 0.01) {
        problems.push(`Mentions ${weight} lb but the rescue record says ${rescue.pounds} lb.`);
      }
    }

    const isPublicFoodPost = context.agent.id === "community-alert" || context.agent.id === "perishable-dispatch";
    if (isPublicFoodPost) {
      const allergens = rescue.allergens
        .split(/[,;/]| and /i)
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean);
      const missing = allergens.filter((a) => !text.includes(a));
      if (missing.length) problems.push(`Allergens not mentioned: ${missing.join(", ")}.`);

      const storageWords: Record<string, string[]> = {
        refrigerated: ["refrigerat", "cold", "fridge", "chilled"],
        frozen: ["frozen", "freezer"],
        ambient: [],
      };
      const words = storageWords[rescue.storage] ?? [];
      if (words.length && !words.some((w) => text.includes(w))) {
        problems.push(`Storage requirement (${rescue.storage}) is not stated.`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

function trimToLimit(platform: SocialPlatform, text: string): string {
  const max = PLATFORM_SPECS[platform].maxChars;
  if (validateForPlatform(platform, text, { imageUrl: "x" }).length <= max) return text;
  const chars = [...text];
  let out = chars.slice(0, max - 1).join("");
  while (validateForPlatform(platform, `${out}…`, { imageUrl: "x" }).length > max) out = [...out].slice(0, -1).join("");
  return `${out.trimEnd()}…`;
}

/**
 * Deterministic copy used when ANTHROPIC_API_KEY is not configured or Claude is
 * unreachable. Always passes checkDraft so the approval flow still works.
 */
export function templateDraft(
  agentId: AgentId,
  platform: SocialPlatform,
  rescue: RescueFacts,
  org: OrganizationFacts,
  settings: AgentSettings = {},
): string {
  const agent = AGENT_DEFINITIONS[agentId];
  const signoff = settings.signoff ?? agent.defaultSignoff;
  const meals = estimateMeals(rescue.pounds, rescue.servings);
  const deadline = formatDeadline(rescue.pickupDeadline);
  const storage = storageLabel(rescue.storage);
  const allergens = rescue.allergens.trim() ? `Allergens: ${rescue.allergens.trim()}.` : "No allergens listed.";
  const where = rescue.recipientAddress || org.address || rescue.pickupAddress;
  const tags = (list: string[]) => {
    const max = PLATFORM_SPECS[platform].maxHashtags;
    return max === 0 ? "" : `\n\n${list.slice(0, max).join(" ")}`;
  };

  let text: string;
  switch (agentId) {
    case "perishable-dispatch":
      text =
        platform === "x"
          ? `URGENT: ${rescue.pounds} lb ${rescue.category} needs a home by ${deadline}. ${storage}. ${allergens} Pantries & shelters: claim it on RescueRelay.`
          : `Urgent surplus: ${rescue.pounds} lb of ${rescue.category} (${rescue.title}) must be claimed by ${deadline}.\n${storage}. ${allergens}\nPickup: ${rescue.pickupAddress}\n\nPantries, shelters and volunteer drivers with capacity — claim it on RescueRelay. ${signoff}${tags(["#FoodRescue", "#ZeroWaste", "#RescueRelay"])}`;
      break;
    case "partner-relay":
      text = `Partner update from ${org.name}: ${rescue.pounds} lb of ${rescue.category} is available for redistribution.\n\n• Storage: ${storage}\n• ${allergens}\n• Pickup: ${rescue.pickupAddress}\n• Deadline: ${deadline}\n\nIf your organization has intake capacity, coordinate through RescueRelay. ${signoff}${tags(["#FoodRescue", "#Nonprofit", "#FoodSecurity"])}`;
      break;
    case "donor-gratitude":
      text = `Thank you${rescue.donorName ? `, ${rescue.donorName},` : ""} for rescuing ${rescue.pounds} lb of ${rescue.category} — about ${meals} meals for neighbors served by ${org.name}.\n\nGood food belongs on tables, not in landfills. Businesses with surplus can donate through RescueRelay. ${signoff}${tags(["#FoodRescue", "#CommunityImpact", "#RescueRelay"])}`;
      break;
    default:
      text =
        platform === "x"
          ? `Free food at ${org.name}: ${rescue.pounds} lb ${rescue.category} (~${meals} meals). ${storage}. ${allergens} ${where}. Until ${deadline}.`
          : `Free food available at ${org.name}!\n\n${rescue.title}: ${rescue.pounds} lb of ${rescue.category} — about ${meals} meals.\n📍 ${where}\n⏰ Until ${deadline}\n❄️ ${storage}\n⚠️ ${allergens}\n\n${signoff}${tags(["#FreeFood", "#FoodRescue", "#Community", "#RescueRelay"])}`;
  }
  return trimToLimit(platform, text);
}

