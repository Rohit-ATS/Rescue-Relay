import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Sparkles, Bot } from 'lucide-react';
import { WORKSPACE_QUERY_KEY } from '@/lib/live-sync';
import { fetchWorkspaceData } from '@/lib/rescue-client';
import { AppShell } from '@/components/rescuerelay/app-shell';
import { AiWorkflows } from '@/components/rescuerelay/ai-workflows';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/_authenticated/workflows')({
  head: () => ({
    meta: [
      { title: 'AI Social & Broadcast Workflows — RescueRelay' },
      {
        name: 'description',
        content:
          'Connect AI agents to LinkedIn, Instagram, X, and Google Maps to automate food rescue community broadcasts.',
      },
      { property: 'og:title', content: 'AI Social & Broadcast Workflows — RescueRelay' },
      {
        property: 'og:description',
        content:
          'Autonomous multi-channel broadcast agents for food banks, pantries, and meal distribution centers.',
      },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: WorkflowsPage,
});

function WorkflowsPage() {
  const navigate = useNavigate();
  const { data, refetch, isFetching, isPending } = useQuery({
    queryKey: WORKSPACE_QUERY_KEY,
    queryFn: () => fetchWorkspaceData(),
    refetchOnWindowFocus: true,
  });

  const roles = data?.roles.map((r) => r.role) ?? [];
  const role = roles[0] ?? 'coordinator';

  function handleNav(view: string) {
    if (view === 'workflows') return;
    void navigate({ to: '/dashboard', search: { tab: view } });
  }

  if (isPending || !data) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Bot className="size-8 animate-pulse text-primary" />
          <p role="status" className="text-sm text-muted-foreground">
            Opening AI Workflows workspace…
          </p>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      name={data.profile?.full_name || 'Rescue partner'}
      role={role}
      view="workflows"
      onView={handleNav}
    >
      <div className="px-4 py-6 md:px-8 md:py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigate({ to: '/dashboard' })}
              className="gap-2"
            >
              <ArrowLeft className="size-4" /> Command center
            </Button>
            <span className="text-xs text-muted-foreground hidden sm:inline">/</span>
            <span className="text-xs font-medium text-muted-foreground hidden sm:inline">
              Automation &amp; Social Outreach
            </span>
          </div>

          <Button
            variant="outline"
            size="icon"
            title="Refresh workspace"
            aria-label="Refresh workspace"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw className={isFetching ? 'animate-spin' : ''} />
          </Button>
        </div>

        <AiWorkflows data={data} role={role} />
      </div>
    </AppShell>
  );
}
