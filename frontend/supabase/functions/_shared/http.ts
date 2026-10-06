// HTTP helpers shared by every edge function.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret, x-org-id, mcp-session-id, mcp-protocol-version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function env(name: string): string | undefined {
  const value = Deno.env.get(name);
  return value && value.trim() ? value.trim() : undefined;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new HttpError(500, `Server is missing ${name}`);
  return value;
}

/** Wraps a handler with CORS preflight and uniform error responses. */
export function serve(handler: (req: Request) => Promise<Response>): void {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      return await handler(req);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
    }
  });
}

export function functionsBaseUrl(): string {
  return `${requireEnv("SUPABASE_URL").replace(/\/$/, "")}/functions/v1`;
}

/** Browser origin of the dashboard, used for OAuth return redirects. */
export function appUrl(): string {
  return (env("APP_URL") ?? "https://rohit-ats.github.io/Rescue-Relay").replace(/\/$/, "");
}

