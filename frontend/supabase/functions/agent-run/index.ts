// Claude-powered AI Agent runner for RescueRelay.
// Synthesizes rescue records, creates drafts, runs deterministic guardrails, and stores into social_posts.

import { adminClient, resolveCaller } from "../_shared/auth.ts";
import { HttpError, json, serve } from "../_shared/http.ts";
import { generateCardSvg } from "../_shared/image-card.ts";
import {
  AGENT_DEFINITIONS,
  buildOrgBlock,
  buildRescueBlock,
  buildSystemPrompt,
  checkDraft,
  estimateMeals,
  formatDeadline,
  isAgentId,
  templateDraft,
  type AgentId,
  type OrganizationFacts,
  type RescueFacts,
} from "../_shared/social/agents.ts";
import {
  PLATFORM_SPECS,
  type SocialPlatform,
} from "../_shared/social/platforms.ts";

serve(async (req) => {
  if (req.method !== "POST") {
    throw new HttpError(405, "Method not allowed. Use POST.");
  }

  const body = await req.json().catch(() => ({}));
  const caller = await resolveCaller(req, body.org_id);
  const orgId = caller.orgId;

  const agentId: AgentId = isAgentId(body.agent_id) ? body.agent_id : "community-alert";
  const agentDef = AGENT_DEFINITIONS[agentId];
  const targetPlatforms: SocialPlatform[] = Array.isArray(body.platforms) && body.platforms.length > 0
    ? body.platforms
    : agentDef.defaultPlatforms;

  const db = adminClient();

  // 1. Fetch organization details
  const { data: orgData, error: orgErr } = await db
    .from("organizations")
    .select("name, address, phone, website, hours_note")
    .eq("id", orgId)
    .single();

  if (orgErr || !orgData) {
    throw new HttpError(404, `Organization not found: ${orgErr?.message}`);
  }

  const orgFacts: OrganizationFacts = {
    name: orgData.name,
    address: orgData.address,
    phone: orgData.phone || undefined,
    website: orgData.website || undefined,
    hoursNote: orgData.hours_note || undefined,
  };

  // 2. Fetch rescue/donation data if provided
  let rescueFacts: RescueFacts | null = null;
  if (body.donation_id) {
    const { data: dData, error: dErr } = await db
      .from("donations")
      .select("id, title, category, pounds, servings, pickup_address, pickup_deadline, storage_required, allergens, notes, status, donor_org_id")
      .eq("id", body.donation_id)
      .maybeSingle();

    if (dData) {
      let donorName: string | null = null;
      if (dData.donor_org_id) {
        const { data: donorOrg } = await db.from("organizations").select("name").eq("id", dData.donor_org_id).maybeSingle();
        donorName = donorOrg?.name || null;
      }

      rescueFacts = {
        id: dData.id,
        title: dData.title,
        category: dData.category,
        pounds: Number(dData.pounds),
        servings: dData.servings,
        pickupAddress: dData.pickup_address,
        pickupDeadline: dData.pickup_deadline,
        storage: dData.storage_required,
        allergens: dData.allergens || "",
        notes: dData.notes || "",
        status: dData.status,
        donorName,
        recipientName: orgFacts.name,
        recipientAddress: orgFacts.address,
      };
    }
  }

  // 3. Prepare AI Prompt or fallback
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const draftsCreated: Array<{ id: string; platform: SocialPlatform; content: string; status: string; guardrailNotes: string[] }> = [];

  for (const platform of targetPlatforms) {
    let content = "";
    let generatedBy = "template";
    let model = "";

    // Generate Visual Card for Instagram / story
    let imageUrl = body.image_url || null;
    if (PLATFORM_SPECS[platform].requiresImage && !imageUrl && rescueFacts) {
      const svg = generateCardSvg({
        title: rescueFacts.title,
        category: rescueFacts.category,
        pounds: rescueFacts.pounds,
        meals: estimateMeals(rescueFacts.pounds, rescueFacts.servings),
        orgName: orgFacts.name,
        address: orgFacts.address,
        deadline: formatDeadline(rescueFacts.pickupDeadline),
        storage: rescueFacts.storage,
      });
      // Store SVG as Data URI or placeholder
      imageUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    if (anthropicKey && anthropicKey.startsWith("sk-ant-")) {
      try {
        const systemPrompt = buildSystemPrompt(agentDef, orgFacts, {
          extraInstructions: body.instructions || "",
        });

        const userMessage = rescueFacts
          ? `${buildRescueBlock(rescueFacts, orgFacts)}\n\nWrite a single post for ${PLATFORM_SPECS[platform].label} adhering strictly to its limit (${PLATFORM_SPECS[platform].maxChars} chars). Output only the post text.`
          : `${buildOrgBlock(orgFacts)}\n\nWrite a general update for ${PLATFORM_SPECS[platform].label} adhering strictly to its limit (${PLATFORM_SPECS[platform].maxChars} chars). Output only the post text.`;

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1000,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
          }),
        });

        if (res.ok) {
          const aiJson = await res.json();
          content = aiJson.content?.[0]?.text?.trim() || "";
          generatedBy = "claude";
          model = "claude-3-5-sonnet";
        }
      } catch (aiErr) {
        console.warn("Claude API call failed, falling back to verified template:", aiErr);
      }
    }

    // Fallback to verified template if AI not configured or failed
    if (!content && rescueFacts) {
      content = templateDraft(agentId, platform, rescueFacts, orgFacts, {
        extraInstructions: body.instructions || "",
      });
      generatedBy = "template";
    } else if (!content) {
      content = `Free food distribution update from ${orgFacts.name}! Check in with us at ${orgFacts.address} or visit RescueRelay for live updates.`;
      generatedBy = "template";
    }

    // Run deterministic safety & fact guardrails
    const guard = checkDraft(
      { platform, content, imageUrl },
      { agent: agentDef, rescue: rescueFacts },
    );

    // Save into social_posts table
    const { data: postRecord, error: postErr } = await db
      .from("social_posts")
      .insert({
        org_id: orgId,
        agent_id: agentId,
        platform,
        kind: "post",
        donation_id: body.donation_id || null,
        trigger: body.trigger || "manual",
        content,
        image_url: imageUrl,
        status: "pending_approval",
        generated_by: generatedBy,
        model,
        guardrail_notes: guard.problems,
        dry_run: body.dry_run ?? true,
        created_by: caller.userId,
      })
      .select("id, platform, content, status, guardrail_notes")
      .single();

    if (!postErr && postRecord) {
      draftsCreated.push({
        id: postRecord.id,
        platform: postRecord.platform as SocialPlatform,
        content: postRecord.content,
        status: postRecord.status,
        guardrailNotes: postRecord.guardrail_notes || [],
      });
    }
  }

  return json({
    success: true,
    agentId,
    orgId,
    drafts: draftsCreated,
  });
});

