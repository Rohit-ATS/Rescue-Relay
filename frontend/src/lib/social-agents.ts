// Client utility to invoke social AI agents and publisher functions.

import { supabase } from "@/integrations/supabase/client";

export async function runSocialAgent(params: {
  agent_id: string;
  donation_id?: string;
  platforms?: string[];
  instructions?: string;
  dry_run?: boolean;
}) {
  const { data, error } = await supabase.functions.invoke("agent-run", {
    body: params,
  });

  if (error) {
    throw new Error(error.message || "Failed to run AI agent");
  }

  return data;
}

export async function publishSocialPost(postId: string) {
  const { data, error } = await supabase.functions.invoke("social-publish", {
    body: { post_id: postId },
  });

  if (error) {
    throw new Error(error.message || "Failed to publish post");
  }

  return data;
}

export async function sweepSocialInbox() {
  const { data, error } = await supabase.functions.invoke("inbox-sweep");

  if (error) {
    throw new Error(error.message || "Failed to sweep social inbox");
  }

  return data;
}

export async function startSocialOAuth(platform: string) {
  const { data, error } = await supabase.functions.invoke("oauth-start", {
    body: { platform, return_to: window.location.href },
  });

  if (error) {
    throw new Error(error.message || "Failed to initiate OAuth");
  }

  if (data?.url) {
    window.location.href = data.url;
  }
}
