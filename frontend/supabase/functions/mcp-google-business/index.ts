// MCP Server for Google Maps / Business Profile: create_local_post, list_reviews, reply_to_review, update_hours

import { handleMcpRequest, type McpTool } from "../_shared/mcp-handler.ts";
import {
  gbpCreateLocalPost,
  gbpListReviews,
  gbpReplyToReview,
  gbpUpdateHours,
  type HoursPeriod,
  type LocalPostInput,
} from "../_shared/providers/google-business.ts";
import { loadConnection } from "../_shared/providers/index.ts";
import { validateForPlatform } from "../_shared/social/platforms.ts";

const tools: McpTool[] = [
  {
    name: "create_local_post",
    description: "Publish a Local Post directly to your Google Maps pin / Google Business Profile (STANDARD, EVENT, or OFFER).",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Post content / announcement (up to 1500 chars)." },
        topicType: { type: "string", enum: ["STANDARD", "EVENT", "OFFER"], description: "Post type." },
        eventTitle: { type: "string", description: "Title if event or offer (e.g. 'Fresh Food Drive')." },
        startIso: { type: "string", description: "Event start date/time ISO string." },
        endIso: { type: "string", description: "Event end date/time ISO string." },
        callToActionUrl: { type: "string", description: "Optional website link for Learn More button." },
      },
      required: ["summary"],
    },
    handler: async (input: LocalPostInput, { orgId, dryRun }) => {
      const val = validateForPlatform("google_business", input.summary);
      if (!val.ok) throw new Error(val.errors.join("; "));

      if (dryRun || !orgId) {
        return {
          dryRun: true,
          status: "simulated",
          summary: input.summary,
          topicType: input.topicType || "STANDARD",
          message: "Google Maps Local Post validated successfully in dry-run mode.",
        };
      }

      const conn = await loadConnection(orgId, "google_business");
      if (!conn) {
        return {
          dryRun: true,
          status: "simulated",
          summary: input.summary,
          message: "Google Business Profile not connected; post simulated.",
        };
      }

      return await gbpCreateLocalPost(conn, input);
    },
  },
  {
    name: "list_reviews",
    description: "Fetch customer reviews left on Google Maps listing.",
    inputSchema: {
      type: "object",
      properties: {
        pageSize: { type: "number", description: "Number of reviews to retrieve (default 20)." },
      },
    },
    handler: async ({ pageSize }, { orgId, dryRun }) => {
      if (dryRun || !orgId) {
        return [
          {
            id: "sim-rev-1",
            author: "Maria S.",
            text: "Such friendly volunteers! Got fresh fruit and bread for our family today.",
            rating: 5,
            createdAt: new Date().toISOString(),
            alreadyReplied: false,
          },
        ];
      }
      const conn = await loadConnection(orgId, "google_business");
      if (!conn) return [];
      return await gbpListReviews(conn, pageSize || 20);
    },
  },
  {
    name: "reply_to_review",
    description: "Post an owner reply to a Google Maps review.",
    inputSchema: {
      type: "object",
      properties: {
        reviewId: { type: "string", description: "Review ID to respond to." },
        text: { type: "string", description: "Reply text." },
      },
      required: ["reviewId", "text"],
    },
    handler: async ({ reviewId, text }, { orgId, dryRun }) => {
      if (dryRun || !orgId) {
        return { id: reviewId, dryRun: true, status: "simulated" };
      }
      const conn = await loadConnection(orgId, "google_business");
      if (!conn) return { id: reviewId, dryRun: true };
      return await gbpReplyToReview(conn, reviewId, text);
    },
  },
  {
    name: "update_hours",
    description: "Update regular operating/distribution hours shown on Google Maps.",
    inputSchema: {
      type: "object",
      properties: {
        periods: {
          type: "array",
          items: {
            type: "object",
            properties: {
              day: { type: "string", enum: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] },
              open: { type: "string", description: "e.g. '09:00'" },
              close: { type: "string", description: "e.g. '17:00'" },
            },
            required: ["day", "open", "close"],
          },
          description: "List of open/close periods per day.",
        },
      },
      required: ["periods"],
    },
    handler: async ({ periods }: { periods: HoursPeriod[] }, { orgId, dryRun }) => {
      if (dryRun || !orgId) {
        return { dryRun: true, status: "simulated", count: periods.length };
      }
      const conn = await loadConnection(orgId, "google_business");
      if (!conn) return { dryRun: true, status: "simulated", count: periods.length };
      return await gbpUpdateHours(conn, periods);
    },
  },
];

Deno.serve(handleMcpRequest("mcp-google-business", "1.0.0", tools));

