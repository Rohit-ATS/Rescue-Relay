// Sweep edge function for Community Inbox: checks mentions, reviews and comments across all accounts and creates pending inbox items.

import { adminClient } from "../_shared/auth.ts";
import { HttpError, json, serve } from "../_shared/http.ts";
import { loadConnection } from "../_shared/providers/index.ts";
import { gbpListReviews } from "../_shared/providers/google-business.ts";
import { instagramListComments } from "../_shared/providers/instagram.ts";
import { linkedinListComments } from "../_shared/providers/linkedin.ts";
import { xListMentions } from "../_shared/providers/x.ts";

serve(async (req) => {
  const db = adminClient();
  const url = new URL(req.url);
  const targetOrgId = url.searchParams.get("org_id");

  // Query connected social accounts
  let query = db.from("social_accounts").select("id, org_id, platform, handle, external_id").eq("status", "connected");
  if (targetOrgId) query = query.eq("org_id", targetOrgId);

  const { data: accounts, error } = await query;
  if (error) throw new HttpError(500, `Failed to load accounts: ${error.message}`);

  let itemsFound = 0;

  for (const acc of accounts || []) {
    const conn = await loadConnection(acc.org_id, acc.platform);
    if (!conn) continue;

    try {
      if (acc.platform === "google_business") {
        const reviews = await gbpListReviews(conn, 10);
        for (const rev of reviews) {
          if (rev.alreadyReplied) continue;
          const { error: insErr } = await db.from("social_inbox_items").upsert({
            org_id: acc.org_id,
            platform: "google_business",
            kind: "review",
            external_id: rev.id,
            author: rev.author,
            body: rev.text,
            rating: rev.rating,
            status: "new",
            received_at: rev.createdAt,
          }, { onConflict: "org_id,platform,external_id" });
          if (!insErr) itemsFound++;
        }
      } else if (acc.platform === "instagram") {
        const comments = await instagramListComments(conn, 5);
        for (const comm of comments) {
          const { error: insErr } = await db.from("social_inbox_items").upsert({
            org_id: acc.org_id,
            platform: "instagram",
            kind: "comment",
            external_id: comm.id,
            parent_external_id: comm.postId,
            author: comm.author,
            body: comm.text,
            status: "new",
            received_at: comm.createdAt,
          }, { onConflict: "org_id,platform,external_id" });
          if (!insErr) itemsFound++;
        }
      } else if (acc.platform === "linkedin") {
        const comments = await linkedinListComments(conn);
        for (const comm of comments) {
          const { error: insErr } = await db.from("social_inbox_items").upsert({
            org_id: acc.org_id,
            platform: "linkedin",
            kind: "comment",
            external_id: comm.id,
            parent_external_id: comm.postId,
            author: comm.author,
            body: comm.text,
            status: "new",
            received_at: comm.createdAt,
          }, { onConflict: "org_id,platform,external_id" });
          if (!insErr) itemsFound++;
        }
      } else if (acc.platform === "x") {
        const mentions = await xListMentions(conn, 10);
        for (const m of mentions) {
          const { error: insErr } = await db.from("social_inbox_items").upsert({
            org_id: acc.org_id,
            platform: "x",
            kind: "mention",
            external_id: m.id,
            parent_external_id: m.postId,
            author: m.author,
            body: m.text,
            status: "new",
            received_at: m.createdAt,
          }, { onConflict: "org_id,platform,external_id" });
          if (!insErr) itemsFound++;
        }
      }
    } catch (sweepErr) {
      console.warn(`Error sweeping inbox for ${acc.platform} (${acc.org_id}):`, sweepErr);
    }
  }

  return json({
    success: true,
    scannedAccounts: (accounts || []).length,
    newInboxItems: itemsFound,
  });
});
