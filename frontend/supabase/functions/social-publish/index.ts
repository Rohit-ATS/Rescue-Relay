// Social publisher edge function: publishes an approved post via its respective platform MCP server or direct API client.

import { adminClient, resolveCaller } from "../_shared/auth.ts";
import { HttpError, json, serve } from "../_shared/http.ts";
import { loadConnection } from "../_shared/providers/index.ts";
import { gbpCreateLocalPost } from "../_shared/providers/google-business.ts";
import { instagramPublish } from "../_shared/providers/instagram.ts";
import { linkedinCreatePost } from "../_shared/providers/linkedin.ts";
import { xCreatePost } from "../_shared/providers/x.ts";
import { validateForPlatform, type SocialPlatform } from "../_shared/social/platforms.ts";

serve(async (req) => {
  if (req.method !== "POST") {
    throw new HttpError(405, "Method not allowed. Use POST.");
  }

  const body = await req.json().catch(() => ({}));
  const postId = body.post_id;
  if (!postId) throw new HttpError(400, "Missing post_id");

  const db = adminClient();

  // 1. Fetch post record
  const { data: post, error: fetchErr } = await db
    .from("social_posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (fetchErr || !post) {
    throw new HttpError(404, `Post not found: ${fetchErr?.message}`);
  }

  // 2. Authorize caller against the organization
  const caller = await resolveCaller(req, post.org_id);

  // 3. Status checks: must be approved or pending_approval
  if (post.status === "published") {
    return json({ success: true, message: "Post was already published", post });
  }

  // Auto-mark approved if caller explicitly executes publish
  await db
    .from("social_posts")
    .update({
      status: "publishing",
      approved_by: caller.userId || post.approved_by,
      approved_at: post.approved_at || new Date().toISOString(),
    })
    .eq("id", postId);

  const platform: SocialPlatform = post.platform;
  const content = post.content;
  const imageUrl = post.image_url;

  // 4. Validate
  const val = validateForPlatform(platform, content, { imageUrl });
  if (!val.ok) {
    await db.from("social_posts").update({ status: "failed", error: val.errors.join("; ") }).eq("id", postId);
    throw new HttpError(400, `Validation failed: ${val.errors.join("; ")}`);
  }

  // 5. Check if dry-run or real account
  const conn = await loadConnection(post.org_id, platform);

  if (!conn || post.dry_run) {
    // Simulated publishing in dry-run mode
    const simulatedId = `sim-${platform}-${Date.now()}`;
    const simulatedUrl = `https://example.com/dry-run/${platform}/${simulatedId}`;

    await db
      .from("social_posts")
      .update({
        status: "published",
        dry_run: true,
        external_post_id: simulatedId,
        external_url: simulatedUrl,
        published_at: new Date().toISOString(),
        error: "",
      })
      .eq("id", postId);

    return json({
      success: true,
      dryRun: true,
      externalPostId: simulatedId,
      externalUrl: simulatedUrl,
      message: `${platform.toUpperCase()} post published in simulated dry-run mode (no live account linked).`,
    });
  }

  // 6. Live platform publishing
  try {
    let result: { id: string; url?: string } = { id: "" };

    if (platform === "linkedin") {
      result = await linkedinCreatePost(conn, content);
    } else if (platform === "instagram") {
      if (!imageUrl) throw new Error("Instagram requires an image URL");
      result = await instagramPublish(conn, imageUrl, content);
    } else if (platform === "x") {
      result = await xCreatePost(conn, content);
    } else if (platform === "google_business") {
      result = await gbpCreateLocalPost(conn, { summary: content, topicType: "STANDARD" });
    }

    await db
      .from("social_posts")
      .update({
        status: "published",
        dry_run: false,
        external_post_id: result.id,
        external_url: result.url || "",
        published_at: new Date().toISOString(),
        error: "",
      })
      .eq("id", postId);

    return json({
      success: true,
      dryRun: false,
      externalPostId: result.id,
      externalUrl: result.url,
      message: `Successfully published live to ${platform.toUpperCase()}!`,
    });
  } catch (pubErr: any) {
    await db
      .from("social_posts")
      .update({
        status: "failed",
        error: pubErr.message || String(pubErr),
      })
      .eq("id", postId);

    throw new HttpError(500, `Failed to publish to ${platform}: ${pubErr.message}`);
  }
});

