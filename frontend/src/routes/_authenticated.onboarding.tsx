import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Car, HeartHandshake } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { completeOnboarding, getWorkspace } from "@/lib/rescue.functions";
import { completeDemoOnboarding, fetchWorkspaceData } from "@/lib/rescue-client";
import { WORKSPACE_QUERY_KEY } from "@/lib/live-sync";
import { Brand } from "@/components/rescuerelay/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Choose your role — RescueRelay" }, { name: "description", content: "Set up your RescueRelay donor, nonprofit, or driver workspace." }] }),
  component: Onboarding,
});

const roles = [
  ["donor", "Food donor", "Post safe surplus in under a minute", Building2],
  ["recipient", "Nonprofit recipient", "Accept food your organization can use", HeartHandshake],
  ["driver", "Volunteer driver", "Pick up and document deliveries", Car],
] as const;

function Onboarding() {
  const navigate = useNavigate();
  const { demoOnly } = Route.useRouteContext() as { demoOnly?: boolean };
  const finish = useServerFn(completeOnboarding);
  const load = useServerFn(getWorkspace);
  const [name, setName] = useState("");
  const [role, setRole] = useState<(typeof roles)[number][0]>("donor");
  const [organizationId, setOrganizationId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const workspace = useQuery({
    queryKey: WORKSPACE_QUERY_KEY,
    queryFn: () => (demoOnly ? fetchWorkspaceData() : load()),
    refetchInterval: demoOnly ? false : 10_000,
  });
  const needsOrganization = role === "donor" || role === "recipient";
  const organizations = useMemo(
    () => (workspace.data?.organizations ?? []).filter((organization) => organization.type === role && organization.verification_status !== "suspended"),
    [workspace.data?.organizations, role],
  );
  const pendingRequest = workspace.data?.membershipRequest?.status === "pending" ? workspace.data.membershipRequest : null;
  const requestedOrganization = pendingRequest ? workspace.data?.organizations.find((organization) => organization.id === pendingRequest.organization_id) : null;

  useEffect(() => {
    if (!demoOnly && workspace.data?.roles.length) void navigate({ to: "/dashboard", replace: true });
    if (workspace.error) setError("Account details could not load. Please try again.");
  }, [workspace.data, workspace.error, demoOnly, navigate]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (demoOnly) {
        await completeDemoOnboarding({
          fullName: name,
          role,
          organizationId: needsOrganization ? organizationId : undefined,
        });
        await navigate({ to: "/dashboard", replace: true });
        return;
      }
      const existing = await load();
      if (existing.roles.length) {
        await navigate({ to: "/dashboard", replace: true });
        return;
      }
      const result = await finish({ data: { fullName: name, role, organizationId: needsOrganization ? organizationId : undefined } });
      if (result.pendingApproval) {
        await workspace.refetch();
        return;
      }
      await navigate({ to: "/dashboard", replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not finish setup.");
    } finally {
      setBusy(false);
    }
  }

  if (!demoOnly && pendingRequest) {
    return <div className="grid min-h-screen place-items-center bg-muted/35 p-5"><main className="w-full max-w-lg rounded-lg border bg-background p-8 shadow-sm"><Brand /><p className="mt-10 text-sm font-bold uppercase text-primary">Membership request pending</p><h1 className="mt-3 text-3xl font-semibold">Waiting for organization approval</h1><p className="mt-3 leading-7 text-muted-foreground">Your request to join {requestedOrganization?.name ?? "the selected organization"} is awaiting a coordinator. Your rescue workspace will unlock as soon as it is approved.</p><Button className="mt-7" variant="outline" onClick={() => void workspace.refetch()} disabled={workspace.isFetching}>Check again</Button></main></div>;
  }

  return <div className="min-h-screen bg-muted/35"><header className="border-b bg-background px-5 py-5 md:px-10"><Brand /></header><main className="mx-auto max-w-4xl px-5 py-14"><p className="text-sm font-bold uppercase text-primary">{demoOnly ? "Demo setup" : "Set up your workspace"}</p><h1 className="mt-3 text-4xl font-semibold">How will you help the relay?</h1><p className="mt-3 text-muted-foreground">{demoOnly ? "For the hackathon demo, organization access is approved instantly in this browser so you can inspect the complete flow." : "Choose your primary role. Access is enforced for every rescue action."}</p><form onSubmit={submit}><div className="mt-9"><Label htmlFor="name">Your full name</Label><Input id="name" className="mt-2 h-11 max-w-md" minLength={2} maxLength={100} required value={name} onChange={(event) => setName(event.target.value)} placeholder="Jordan Lee" /></div><div className="mt-8 grid gap-3 md:grid-cols-2">{roles.map(([value, title, copy, Icon]) => <Button variant="outline" key={value} type="button" aria-pressed={role === value} onClick={() => { setRole(value); setOrganizationId(""); }} className={`h-auto min-h-32 justify-start whitespace-normal p-5 text-left transition ${role === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-background hover:border-primary/45"}`}><span className={`mr-2 grid size-10 shrink-0 place-items-center rounded-md ${role === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}><Icon className="size-5" /></span><span><span className="font-semibold">{title}</span><span className="mt-1 block text-sm leading-6 text-muted-foreground">{copy}</span></span></Button>)}</div>{needsOrganization && <div className="mt-8 max-w-md"><Label htmlFor="organization">Organization</Label><Select value={organizationId} onValueChange={setOrganizationId}><SelectTrigger id="organization" className="mt-2 h-11"><SelectValue placeholder={organizations.length ? "Choose your organization" : "No eligible organizations available"} /></SelectTrigger><SelectContent>{organizations.map((organization) => <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>)}</SelectContent></Select><p className="mt-2 text-sm text-muted-foreground">{demoOnly ? "Demo approval is instant and stays in this browser." : "A coordinator must approve this membership before organization data and actions are available."}</p></div>}{error && <p role="alert" className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}<Button className="mt-8 h-11 px-8" disabled={busy || (needsOrganization && !organizationId) || (needsOrganization && !organizations.length)}>{busy ? "Setting up…" : demoOnly && needsOrganization ? "Join demo organization" : needsOrganization ? "Request access" : "Enter RescueRelay"}</Button></form></main></div>;
}
