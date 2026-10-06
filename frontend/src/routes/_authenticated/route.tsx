import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Check local session first to prevent false redirects during network hiccups
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) {
      // Fallback check with getUser
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        throw redirect({ to: "/auth" });
      }
      return { user: data.user };
    }
    return { user: sessionData.session.user };
  },
  component: () => <Outlet />,
});
