import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, RefreshCw, Users } from "lucide-react";
import { approveMembershipRequest, getPendingMembershipRequests } from "@/lib/rescue.functions";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/rescuerelay/brand";

export const Route = createFileRoute("/_authenticated/memberships")({
  head: () => ({ meta: [{ title: "Membership requests — RescueRelay" }] }),
  component: MembershipRequests,
});

function MembershipRequests() {
  const loadRequests = useServerFn(getPendingMembershipRequests);
  const approve = useServerFn(approveMembershipRequest);
  const requests = useQuery({ queryKey: ["membership-requests"], queryFn: () => loadRequests() });

  async function approveRequest(requestId: string) {
    await approve({ data: { requestId } });
    await requests.refetch();
  }

  return <div className="min-h-screen bg-muted/35"><header className="flex items-center justify-between border-b bg-background px-5 py-5 md:px-10"><Brand /><Button asChild variant="outline"><Link to="/dashboard">Back to dashboard</Link></Button></header><main className="mx-auto max-w-4xl px-5 py-14"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase text-primary">Coordinator review</p><h1 className="mt-3 text-4xl font-semibold">Membership requests</h1><p className="mt-3 text-muted-foreground">Approve only people you have verified belong to the listed organization.</p></div><Button variant="outline" size="icon" aria-label="Refresh requests" onClick={() => void requests.refetch()} disabled={requests.isFetching}><RefreshCw className={requests.isFetching ? "animate-spin" : ""} /></Button></div>{requests.error ? <p role="alert" className="mt-8 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{requests.error instanceof Error ? requests.error.message : "Could not load membership requests."}</p> : <section className="mt-8 divide-y rounded-lg border bg-background">{requests.isPending ? <p className="p-6 text-sm text-muted-foreground">Loading requests…</p> : requests.data?.length ? requests.data.map((request) => <article key={request.id} className="flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="font-semibold">{request.requesterName}</p><p className="mt-1 text-sm text-muted-foreground">{request.requested_role} → {request.organizationName}</p><p className="mt-1 text-xs text-muted-foreground">Requested {new Date(request.requested_at).toLocaleString()}</p></div><Button onClick={() => void approveRequest(request.id)}><Check /> Approve</Button></article>) : <div className="p-10 text-center"><Users className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 font-medium">No pending requests</p><p className="mt-1 text-sm text-muted-foreground">New organization-membership requests will appear here.</p></div>}</section>}</main></div>;
}
