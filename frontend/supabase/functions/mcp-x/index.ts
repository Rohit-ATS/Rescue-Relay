// MCP Server for X (Twitter): create_post, create_thread, list_mentions, reply

import { handleMcpRequest, type McpTool } from "../_shared/mcp-handler.ts";
import { loadConnection } from "../_shared/providers/index.ts";
import { xCreatePost, xCreateThread, xListMentions } from "../_shared/providers/x.ts";
import { validateForPlatform } from "../_shared/social/platforms.ts";

const tools: McpTool[] = [
  {
    name: "create_post",
    description: "Post a single tweet / post to X (up to 280 characters).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Tweet text." },
      },
      required: ["text"],
    },
    handler: async ({ text }, { orgId, dryRun }) => {
      const val = validateForPlatform("x", text);
      if (!val.ok) throw new Error(val.errors.join("; "));

      if (dryRun || !orgId) {
        return {
          dryRun: true,
          status: "simulated",
          text,
          message: "X post validated successfully in dry-run mode.",
        };
      }

      const conn = await loadConnection(orgId, "x");
      if (!conn) {
        return {
          dryRun: true,
          status: "simulated",
          text,
          message: "X account not connected; post simulated.",
        };
      }

      return await xCreatePost(conn, text);
    },
  },
  {
    name: "create_thread",
    description: "Publish a connected sequence (thread) of tweets.",
    inputSchema: {
      type: "object",
      properties: {
        parts: {
          type: "array",
          items: { type: "string" },
          description: "Array of tweet texts, each <= 280 chars.",
        },
      },
      required: ["parts"],
    },
    handler: async ({ parts }, { orgId, dryRun }) => {
      for (const p of parts) {
        const val = validateForPlatform("x", p);
        if (!val.ok) throw new Error(`Thread item invalid: ${val.errors.join("; ")}`);
      }

      if (dryRun || !orgId) {
        return { dryRun: true, status: "simulated", count: parts.length };
      }

      const conn = await loadConnection(orgId, "x");
      if (!conn) return { dryRun: true, status: "simulated", count: parts.length };
      return await xCreateThread(conn, parts);
    },
  },
  {
    name: "list_mentions",
    description: "List recent tweets mentioning the connected account.",
    inputSchema: {
      type: "object",
      properties: {
        max: { type: "number", description: "Maximum mentions to fetch (5-100)." },
      },
    },
    handler: async ({ max }, { orgId, dryRun }) => {
      if (dryRun || !orgId) {
        return [
          {
            id: "sim-x-1",
            postId: "tweet-123",
            author: "@NeighborDSM",
            text: "Does the food bank need extra cooler boxes today? We can drop 4 off.",
            createdAt: new Date().toISOString(),
          },
        ];
      }
      const conn = await loadConnection(orgId, "x");
      if (!conn) return [];
      return await xListMentions(conn, max || 20);
    },
  },
  {
    name: "reply",
    description: "Post a reply to an existing tweet.",
    inputSchema: {
      type: "object",
      properties: {
        inReplyToId: { type: "string", description: "ID of the tweet being replied to." },
        text: { type: "string", description: "Reply text (<= 280 chars)." },
      },
      required: ["inReplyToId", "text"],
    },
    handler: async ({ inReplyToId, text }, { orgId, dryRun }) => {
      const val = validateForPlatform("x", text);
      if (!val.ok) throw new Error(val.errors.join("; "));

      if (dryRun || !orgId) {
        return { dryRun: true, status: "simulated", inReplyToId, text };
      }
      const conn = await loadConnection(orgId, "x");
      if (!conn) return { dryRun: true, status: "simulated", inReplyToId };
      return await xCreatePost(conn, text, inReplyToId);
    },
  },
];

Deno.serve(handleMcpRequest("mcp-x", "1.0.0", tools));
