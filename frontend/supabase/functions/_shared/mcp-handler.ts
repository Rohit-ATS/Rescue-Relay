// Standard MCP Streamable JSON-RPC HTTP transport handler for Supabase Edge Functions.

import { corsHeaders, HttpError, json } from "../_shared/http.ts";
import { resolveCaller } from "../_shared/auth.ts";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** External mutations require the accountable coordinator role. */
  requiresCoordinator?: boolean;
  handler: (args: any, context: { orgId: string; dryRun: boolean }) => Promise<any>;
}

export function handleMcpRequest(serverName: string, version: string, tools: McpTool[]) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return json({ error: "Method not allowed. MCP server accepts POST JSON-RPC requests." }, 405);
    }

    // A coordinator may select a different organization, but the selection is
    // always validated by resolveCaller before a tool can use it. Regular
    // members are bound to their own organization.
    const requestedOrgId = req.headers.get("x-org-id");
    const dryRun = req.headers.get("x-dry-run") === "true";

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
        400,
      );
    }

    const { jsonrpc, id, method, params } = body;
    if (jsonrpc !== "2.0") {
      return json(
        { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid Request" } },
        400,
      );
    }

    // 1. Initialize
    if (method === "initialize") {
      return json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: serverName, version },
        },
      });
    }

    // 2. Notifications (e.g. notifications/initialized)
    if (method === "notifications/initialized") {
      return json({ jsonrpc: "2.0", id: null, result: {} });
    }

    // 3. List tools
    if (method === "tools/list") {
      return json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      });
    }

    // 4. Call tool
    if (method === "tools/call") {
      let caller;
      try {
        caller = await resolveCaller(req, requestedOrgId);
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        return json(
          {
            jsonrpc: "2.0",
            id: id ?? null,
            error: {
              code: -32001,
              message: error instanceof Error ? error.message : "Unauthorized",
            },
          },
          status,
        );
      }
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const targetTool = tools.find((t) => t.name === toolName);

      if (!targetTool) {
        return json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Tool not found: ${toolName}` },
        });
      }

      if (targetTool.requiresCoordinator && !caller.isCoordinator && !dryRun) {
        return json(
          {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32001,
              message: "Coordinator access required for external account changes",
            },
          },
          403,
        );
      }

      try {
        const toolOutput = await targetTool.handler(toolArgs, { orgId: caller.orgId, dryRun });
        return json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text:
                  typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput, null, 2),
              },
            ],
            isError: false,
          },
        });
      } catch (err: any) {
        return json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: `Error executing ${toolName}: ${err.message || String(err)}`,
              },
            ],
            isError: true,
          },
        });
      }
    }

    return json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  };
}
