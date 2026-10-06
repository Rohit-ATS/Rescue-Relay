// MCP Server for Instagram: publish_image_post, publish_story, list_comments, reply_to_comment, get_insights

import { handleMcpRequest, type McpTool } from "../_shared/mcp-handler.ts";
import { loadConnection } from "../_shared/providers/index.ts";
import {
  instagramInsights,
  instagramListComments,
  instagramPublish,
  instagramReply,
} from "../_shared/providers/instagram.ts";
import { validateForPlatform } from "../_shared/social/platforms.ts";

const tools: McpTool[] = [
  {
    name: "publish_image_post",
    description: "Publish an image feed post to Instagram Business account.",
    inputSchema: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "Publicly accessible image URL (JPEG/PNG)." },
        caption: { type: "string", description: "Post caption with hashtags (up to 2200 chars)." },
      },
      required: ["imageUrl", "caption"],
    },
    handler: async ({ imageUrl, caption }, { orgId, dryRun }) => {
      const val = validateForPlatform("instagram", caption, { imageUrl });
      if (!val.ok) throw new Error(val.errors.join("; "));

      if (dryRun || !orgId) {
        return {
          dryRun: true,
          status: "simulated",
          caption,
          imageUrl,
          message: "Instagram image post validated successfully in dry-run mode.",
        };
      }

      const conn = await loadConnection(orgId, "instagram");
      if (!conn) {
        return {
          dryRun: true,
          status: "simulated",
          caption,
          imageUrl,
          message: "Instagram account not connected; post simulated.",
        };
      }

      return await instagramPublish(conn, imageUrl, caption, false);
    },
  },
  {
    name: "publish_story",
    description: "Publish a 24-hour visual Story to Instagram.",
    inputSchema: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "Publicly accessible image URL." },
      },
      required: ["imageUrl"],
    },
    handler: async ({ imageUrl }, { orgId, dryRun }) => {
      if (dryRun || !orgId) {
        return { dryRun: true, status: "simulated", imageUrl };
      }
      const conn = await loadConnection(orgId, "instagram");
      if (!conn) return { dryRun: true, status: "simulated", imageUrl };
      return await instagramPublish(conn, imageUrl, "", true);
    },
  },
  {
    name: "list_comments",
    description: "List recent comments across Instagram posts.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of media posts to inspect (default 10)." },
      },
    },
    handler: async ({ limit }, { orgId, dryRun }) => {
      if (dryRun || !orgId) {
        return [
          {
            id: "sim-ig-1",
            postId: "media-123",
            author: "@community_volunteer",
            text: "Are there any dietary/vegan options included in today's distribution?",
            createdAt: new Date().toISOString(),
          },
        ];
      }
      const conn = await loadConnection(orgId, "instagram");
      if (!conn) return [];
      return await instagramListComments(conn, limit || 10);
    },
  },
  {
    name: "reply_to_comment",
    description: "Reply to an Instagram comment.",
    inputSchema: {
      type: "object",
      properties: {
        commentId: { type: "string", description: "ID of the target comment." },
        text: { type: "string", description: "Reply text." },
      },
      required: ["commentId", "text"],
    },
    handler: async ({ commentId, text }, { orgId, dryRun }) => {
      if (dryRun || !orgId) {
        return { id: "sim-reply-ig", dryRun: true, status: "simulated" };
      }
      const conn = await loadConnection(orgId, "instagram");
      if (!conn) return { id: "sim-reply-ig", dryRun: true };
      return await instagramReply(conn, commentId, text);
    },
  },
  {
    name: "get_insights",
    description: "Fetch reach, impressions and engagement metrics for an Instagram media post.",
    inputSchema: {
      type: "object",
      properties: {
        mediaId: { type: "string", description: "Instagram media ID." },
      },
      required: ["mediaId"],
    },
    handler: async ({ mediaId }, { orgId, dryRun }) => {
      if (dryRun || !orgId) {
        return { reach: 180, likes: 24, comments: 5, shares: 7, dryRun: true };
      }
      const conn = await loadConnection(orgId, "instagram");
      if (!conn) return { reach: 0, likes: 0, dryRun: true };
      return await instagramInsights(conn, mediaId);
    },
  },
];

Deno.serve(handleMcpRequest("mcp-instagram", "1.0.0", tools));
