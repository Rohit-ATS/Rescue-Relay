// MCP Server for LinkedIn: create_post, get_post_stats, list_comments, reply_to_comment

import { handleMcpRequest, type McpTool } from "../_shared/mcp-handler.ts";
import { loadConnection } from "../_shared/providers/index.ts";
import {
  linkedinCreatePost,
  linkedinListComments,
  linkedinPostStats,
  linkedinReply,
} from "../_shared/providers/linkedin.ts";
import { validateForPlatform } from "../_shared/social/platforms.ts";

const tools: McpTool[] = [
  {
    name: "create_post",
    description: "Publish a post to LinkedIn company page or profile.",
    requiresCoordinator: true,
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Post commentary text (up to 3000 chars)." },
      },
      required: ["text"],
    },
    handler: async ({ text }, { orgId, dryRun }) => {
      const val = validateForPlatform("linkedin", text);
      if (!val.ok) throw new Error(val.errors.join("; "));

      if (dryRun || !orgId) {
        return {
          dryRun: true,
          status: "simulated",
          text,
          message: "LinkedIn post validated successfully in dry-run mode.",
        };
      }

      const conn = await loadConnection(orgId, "linkedin");
      if (!conn) {
        return {
          dryRun: true,
          status: "simulated",
          text,
          message: "LinkedIn account not connected; post simulated.",
        };
      }

      return await linkedinCreatePost(conn, text);
    },
  },
  {
    name: "get_post_stats",
    description: "Get reaction and comment counts for a LinkedIn post.",
    inputSchema: {
      type: "object",
      properties: {
        postUrn: { type: "string", description: "URN of the post (urn:li:share:... or urn:li:ugcPost:...)" },
      },
      required: ["postUrn"],
    },
    handler: async ({ postUrn }, { orgId, dryRun }) => {
      if (dryRun || !orgId) {
        return { reactions: 14, comments: 3, dryRun: true };
      }
      const conn = await loadConnection(orgId, "linkedin");
      if (!conn) return { reactions: 0, comments: 0, dryRun: true };
      return await linkedinPostStats(conn, postUrn);
    },
  },
  {
    name: "list_comments",
    description: "List recent comments on organization posts.",
    inputSchema: {
      type: "object",
      properties: {
        postUrn: { type: "string", description: "Optional specific post URN." },
      },
    },
    handler: async ({ postUrn }, { orgId, dryRun }) => {
      if (dryRun || !orgId) {
        return [
          {
            id: "sim-li-1",
            postId: postUrn || "urn:li:share:123",
            author: "Local Partner Coordinator",
            text: "Thanks for coordinating this pickup! Our shelter will be there at 2pm.",
            createdAt: new Date().toISOString(),
          },
        ];
      }
      const conn = await loadConnection(orgId, "linkedin");
      if (!conn) return [];
      return await linkedinListComments(conn, postUrn);
    },
  },
  {
    name: "reply_to_comment",
    description: "Reply to an existing comment on a LinkedIn post.",
    requiresCoordinator: true,
    inputSchema: {
      type: "object",
      properties: {
        postUrn: { type: "string", description: "URN of the parent post." },
        commentUrn: { type: "string", description: "URN of the comment being replied to." },
        text: { type: "string", description: "Reply message text." },
      },
      required: ["postUrn", "text"],
    },
    handler: async ({ postUrn, commentUrn, text }, { orgId, dryRun }) => {
      if (dryRun || !orgId) {
        return { id: "sim-reply-li", dryRun: true, status: "simulated" };
      }
      const conn = await loadConnection(orgId, "linkedin");
      if (!conn) return { id: "sim-reply-li", dryRun: true };
      return await linkedinReply(conn, postUrn, commentUrn, text);
    },
  },
];

Deno.serve(handleMcpRequest("mcp-linkedin", "1.0.0", tools));
