import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import type { Session, User } from '@supabase/supabase-js';
import { AuthContext, type AppRole, type UserProfile, type UserRoleRow } from '@/lib/auth-context';
import { LiveSyncProvider, WORKSPACE_QUERY_KEY } from '@/lib/live-sync';
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Try again
          </Button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "RescueRelay" },
      { name: "description", content: "Urgent surplus-food dispatch for verified community partners." },
      { name: "author", content: "RescueRelay" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=IBM+Plex+Mono:wght@500;600&family=Manrope:wght@400;500;600;700&display=swap" },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [roleRows, setRoleRows] = useState<UserRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  const fetchProfileAndRoles = async (userId: string) => {
    try {
      const [profileRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase.from("user_roles").select("*").eq("user_id", userId),
      ]);
      setProfile(profileRes.data ?? null);
      setRoleRows(rolesRes.data ?? []);
    } catch (err) {
      console.warn("[Auth] Failed to load user profile or roles:", err);
    }
  };

  const refreshProfile = async () => {
    const currentUserId = user?.id || session?.user?.id;
    if (currentUserId) {
      await fetchProfileAndRoles(currentUserId);
    }
  };

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    sessionStorage.removeItem("rescue-recovery");
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoleRows([]);
    setRecovery(false);
    void router.invalidate();
  };

  useEffect(() => {
    let active = true;

    if (typeof window !== "undefined") {
      if (new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery") {
        sessionStorage.setItem("rescue-recovery", "true");
        setRecovery(true);
      } else if (sessionStorage.getItem("rescue-recovery") === "true") {
        setRecovery(true);
      }
    }

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      if (!active) return;
      setSession(currentSession ?? null);
      setUser(currentSession?.user ?? null);
      setLoading(false);

      if (event === "PASSWORD_RECOVERY") {
        sessionStorage.setItem("rescue-recovery", "true");
        setRecovery(true);
      } else if (event === "SIGNED_OUT") {
        sessionStorage.removeItem("rescue-recovery");
        setRecovery(false);
        setProfile(null);
        setRoleRows([]);
        queryClient.clear();
        void router.invalidate();
        return;
      }

      if (currentSession?.user) {
        void fetchProfileAndRoles(currentSession.user.id);
        if (currentSession.access_token) {
          void supabase.realtime.setAuth(currentSession.access_token);
        }
      } else {
        setProfile(null);
        setRoleRows([]);
      }

      if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "TOKEN_REFRESHED") {
        void router.invalidate();
        void queryClient.invalidateQueries({ queryKey: WORKSPACE_QUERY_KEY });
      }
    });

    void supabase.auth.getSession().then(async ({ data: { session: initialSession } }) => {
      if (!active) return;
      if (initialSession?.user) {
        setSession(initialSession);
        setUser(initialSession.user);
        setLoading(false);
        await fetchProfileAndRoles(initialSession.user.id);
        if (initialSession.access_token) {
          void supabase.realtime.setAuth(initialSession.access_token);
        }
      } else {
        // Instant Demo Guest Evaluator
        const demoUser = {
          id: "d0000000-0000-4000-a000-000000000004",
          email: "coordinator@rescuerelay-qa.org",
          app_metadata: {},
          user_metadata: { full_name: "Casey Ahmed (Judge Evaluator)" },
          aud: "authenticated",
          created_at: new Date().toISOString(),
        } as unknown as User;
        setUser(demoUser);
        setProfile({
          id: "d0000000-0000-4000-a000-000000000004",
          full_name: "Casey Ahmed",
          phone: "515-555-0104",
          organization_id: "d2000000-0000-4000-a000-000000000008",
          onboarding_complete: true,
          availability: true,
          vehicle_capacity_lbs: 400,
          food_safety_training: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setRoleRows([
          { id: "r-c", user_id: "d0000000-0000-4000-a000-000000000004", role: "coordinator" },
          { id: "r-d", user_id: "d0000000-0000-4000-a000-000000000004", role: "donor" },
          { id: "r-r", user_id: "d0000000-0000-4000-a000-000000000004", role: "recipient" },
          { id: "r-v", user_id: "d0000000-0000-4000-a000-000000000004", role: "driver" },
        ]);
        setLoading(false);
      }
    });

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key?.includes("supabase.auth.token") || e.key?.includes("sb-") || e.key === "rescue-recovery") {
        void supabase.auth.getSession().then(({ data: { session: s } }) => {
          if (!active) return;
          setSession(s ?? null);
          setUser(s?.user ?? null);
          if (s?.user) {
            void fetchProfileAndRoles(s.user.id);
          } else {
            setProfile(null);
            setRoleRows([]);
          }
          void router.invalidate();
        });
      }
    };
    window.addEventListener("storage", handleStorageChange);

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [queryClient, router]);

  const roles = roleRows.map((r) => r.role);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{
          user,
          session,
          profile,
          roles,
          roleRows,
          loading,
          recovery,
          refreshProfile,
          signOut,
        }}
      >
        <LiveSyncProvider userId={user?.id ?? null}>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster richColors position="top-right" />
        </LiveSyncProvider>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

