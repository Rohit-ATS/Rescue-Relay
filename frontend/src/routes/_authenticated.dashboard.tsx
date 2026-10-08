import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveState, useLiveStatus, WORKSPACE_QUERY_KEY } from '@/lib/live-sync';
import { useServerFn } from '@tanstack/react-start';
import { AlertTriangle, ArrowRight, Check, Clock3, Leaf, MapPin, PackageCheck, RefreshCw, Scale, ShieldCheck, Truck, X, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/rescuerelay/app-shell';
import { LiveMap, type MapPoint } from '@/components/rescuerelay/live-map';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { deleteOwnDonation, fetchWorkspaceData, performRescueAction, updatePartnerVerification } from '@/lib/rescue-client';
import { buildActivityFeed, type RescueActivity } from '@/lib/rescue-activity';
import { fetchPublicFoodBanks, type PublicFoodBank } from '@/lib/food-banks';
import { DonationDialog } from '@/components/rescuerelay/donation-dialog';
import { formatMoment } from '@/lib/format';
import { SlideSwap } from '@/components/rescuerelay/slide-swap';
import { buildOpportunities, listPartners, summarizePartner, type Opportunity } from '@/lib/rescue-opportunities';
import { ActivityCard, Empty, OpportunityBoard, PartnerDirectory, RelayBoard, RescueDetailDialog } from '@/components/rescuerelay/workspace-cards';
import { useViewerLocation } from '@/lib/use-viewer-location';
import { appleDirectionsUrl, directionsUrl, hasPosition } from '@/lib/geo';
export const Route=createFileRoute('/_authenticated/dashboard')({
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === 'string' ? search.tab : undefined,
  }),
  head:()=>({meta:[{title:'Rescue command center — RescueRelay'},{name:'description',content:'Coordinate urgent food donations, nonprofit matches, volunteer routes, and recorded impact.'},{property:'og:title',content:'RescueRelay command center'},{property:'og:description',content:'Live dispatch, partner verification, and food rescue history.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),
  component:Dashboard
});
type Workspace=Awaited<ReturnType<typeof fetchWorkspaceData>>;
const tone:Record<string,string>={open:'bg-signal/10 text-signal-strong border-signal/20',accepted:'bg-success/10 text-success border-success/20',driver_assigned:'bg-info/10 text-info border-info/20',picked_up:'bg-info/10 text-info border-info/20',delivered:'bg-success/10 text-success border-success/20',expired:'bg-muted text-muted-foreground'};
const inactive=['delivered','expired','cancelled'];
/** Deadline copy is minute-granular, so a coarse shared tick keeps expiry honest without a per-second re-render. */
const CLOCK_TICK_MS=15000;
/** Realtime pushes changes; polling is the safety net, so it backs off while the socket is healthy. */
const POLL_LIVE_MS=60000;
const POLL_DEGRADED_MS=5000;
const date=formatMoment;
/** Des Moines pilot centre, used to look up public food banks before a viewer shares a location. */
const PILOT_CENTRE={latitude:41.5908,longitude:-93.6208};
function Dashboard(){
 const navigate=useNavigate();const queryClient=useQueryClient();
 const connection=useLiveStatus();void queryClient;
 const search=Route.useSearch();
 // False when there is no real Supabase session behind this visitor: writes then
 // land in a per-browser store that no other screen can read.
 const {demoOnly}=Route.useRouteContext() as {demoOnly?:boolean};
 const {data,error,isPending,isFetching,refetch}=useQuery({queryKey:WORKSPACE_QUERY_KEY,queryFn:()=>fetchWorkspaceData(),refetchInterval:connection==='Live'?POLL_LIVE_MS:POLL_DEGRADED_MS,refetchOnWindowFocus:true,refetchOnReconnect:true});
 const location=useViewerLocation({requestOnLoad:true});
 const [feed,setFeed]=useState<RescueActivity['phase']>('current');
 const [routeRun,setRouteRun]=useState<Opportunity|null>(null);const [routeSummary,setRouteSummary]=useState<{distance:string;duration:string;followsRoads?:boolean}|null>(null); const [detailId,setDetailId]=useState(''); const [tab,setTab]=useState(search?.tab||'overview');const [selected,setSelected]=useState('');const [busy,setBusy]=useState(false);const [clock,setClock]=useState(Date.now());
 useEffect(()=>{if(search?.tab)setTab(search.tab);},[search?.tab]);
 useEffect(()=>{const onUpdated=()=>void refetch(); window.addEventListener('rescuerelay:workspace-updated', onUpdated); return ()=>window.removeEventListener('rescuerelay:workspace-updated', onUpdated);},[refetch]);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),CLOCK_TICK_MS);return()=>clearInterval(timer);},[]);
 // Public food banks from OpenStreetMap. Fetched once per centre, and never
 // allowed to fail loudly: an empty list just means the map shows partners only.
 const [publicBanks,setPublicBanks]=useState<PublicFoodBank[]>([]);
 // Centred on the rescues, NOT on the viewer. A dispatcher in California
 // looking at Des Moines donations was being shown Californian food banks, so
 // the map spanned two thousand miles and framed empty country between them.
 const banksCentre=useMemo(()=>{
  const placed=(data?.donations??[]).filter(d=>Number.isFinite(d.latitude)&&Number.isFinite(d.longitude));
  if(!placed.length)return location.coords??PILOT_CENTRE;
  return {latitude:placed.reduce((n,d)=>n+d.latitude,0)/placed.length,longitude:placed.reduce((n,d)=>n+d.longitude,0)/placed.length};
 },[data?.donations,location.coords]);
 useEffect(()=>{
  const controller=new AbortController();
  void fetchPublicFoodBanks(banksCentre.latitude,banksCentre.longitude,{signal:controller.signal}).then(setPublicBanks);
  return()=>controller.abort();
 },[banksCentre.latitude,banksCentre.longitude]);
 const allPoints=useMemo<MapPoint[]>(()=>data?[...data.donations.filter(d=>!inactive.includes(d.status)).map(d=>({id:d.id,lat:d.latitude,lng:d.longitude,label:d.title,kind:'donor' as const})),...data.organizations.filter(o=>o.type==='recipient').map(o=>({id:o.id,lat:o.latitude,lng:o.longitude,label:o.name,kind:'recipient' as const})),...publicBanks.map(b=>({id:b.id,lat:b.latitude,lng:b.longitude,label:b.name,kind:'public' as const}))]:[],[data,publicBanks]);
 const roles=data?.roles.map(r=>r.role)??[];const coordinator=roles.includes('coordinator');const role=roles[0]??'donor';
 const available=data?.donations.filter(d=>!inactive.includes(d.status))??[];
 const active=data?.donations.find(d=>d.id===selected)??available[0]??data?.donations[0];
 const matches=data?.matches.filter(m=>m.donation_id===active?.id)??[];
 const visibleMatches=role==='recipient'?matches.filter(m=>m.recipient_org_id===data?.profile?.organization_id):matches;
 const accepted=matches.find(m=>m.status==='accepted');
 const delivery=data?.deliveries.find(d=>d.match_id===accepted?.id);
 const recipient=data?.organizations.find(o=>o.id===accepted?.recipient_org_id);
 const detailPoints=useMemo<MapPoint[]>(()=>active?[...(location.coords&&hasPosition(location.coords)?[{id:'viewer-location',lat:location.coords.latitude,lng:location.coords.longitude,label:'Your location',kind:'donor' as const}]:[]),{id:active.id,lat:active.latitude,lng:active.longitude,label:active.title,kind:'donor'},...(recipient?[{id:recipient.id,lat:recipient.latitude,lng:recipient.longitude,label:recipient.name,kind:'recipient' as const}]:[])]:[],[active,recipient,location.coords]);
 const detailRoute=useMemo(()=>(active&&accepted&&recipient?location.coords&&hasPosition(location.coords)?{origin:{lat:location.coords.latitude,lng:location.coords.longitude},waypoints:[{lat:active.latitude,lng:active.longitude}],destination:{lat:recipient.latitude,lng:recipient.longitude}}:{origin:{lat:active.latitude,lng:active.longitude},destination:{lat:recipient.latitude,lng:recipient.longitude}}:undefined),[active,accepted,recipient,location.coords]);
 const activity=useMemo(()=>buildActivityFeed({userId:data?.userId??'',organizationId:data?.profile?.organization_id??null,roles,donations:data?.donations??[],matches:data?.matches??[],deliveries:data?.deliveries??[]},clock),[data,roles,clock]);
 const waitingCount=activity.current.filter(a=>a.waitingOnYou).length;
 const opportunities=useMemo(()=>buildOpportunities({donations:data?.donations??[],matches:data?.matches??[],organizations:data?.organizations??[],deliveries:data?.deliveries??[],viewer:location.coords},clock),[data,location.coords,clock]);
 const partners=useMemo(()=>listPartners(data?.organizations??[],location.coords),[data,location.coords]);
 const donorOrgIdByDonation=useMemo(()=>new Map((data?.donations??[]).map(d=>[d.id,d.donor_org_id])),[data]);
 const summarizePartnerById=useMemo(()=>(id:string)=>summarizePartner(id,{donations:data?.donations??[],matches:data?.matches??[],donorOrgIdByDonation}),[data,donorOrgIdByDonation]);
 const completed=data?.donations.filter(d=>d.status==='delivered')??[];const pounds=completed.reduce((n,d)=>n+Number(d.pounds),0);
 const duration=data?.deliveries.filter(d=>d.picked_up_at&&d.delivered_at).map(d=>(new Date(d.delivered_at??'').getTime()-new Date(d.picked_up_at??'').getTime())/60000).filter(n=>Number.isFinite(n)&&n>=0)??[];
 const median=duration.length?[...duration].sort((a,b)=>a-b)[Math.floor(duration.length/2)]:undefined;
 async function refresh(){await refetch();}
 async function act(id:string,action:'accept'|'decline'|'unsafe'|'claim'|'pickup'|'deliver'){
  setBusy(true);try{await performRescueAction(id,action);toast.success({accept:'Rescue accepted',decline:'Match declined',unsafe:'Match flagged unsafe',claim:'Route assigned',pickup:'Pickup recorded',deliver:'Delivery recorded'}[action]);await refresh();}catch(err){toast.error(err instanceof Error?err.message:'Action failed');}finally{setBusy(false);}
 }
 async function changeVerification(id:string,status:'verified'|'suspended'){setBusy(true);try{await updatePartnerVerification(id,status);toast.success('Partner verification updated');await refresh();}catch(err){toast.error(err instanceof Error?err.message:'Update failed');}finally{setBusy(false);}}
 async function deleteDonation(id:string){setBusy(true);try{await deleteOwnDonation(id);if(routeRun?.donationId===id){setRouteRun(null);setRouteSummary(null);}if(detailId===id)setDetailId('');if(selected===id)setSelected('');toast.success('Surplus post deleted');await refresh();}catch(err){toast.error(err instanceof Error?err.message:'Could not delete surplus post');}finally{setBusy(false);}}
 if(isPending||(data&&!data.roles.length))return <div className="grid min-h-screen place-items-center"><p role="status" className="text-muted-foreground">Opening your workspace…</p></div>;
 if(!data)return <div className="grid min-h-screen place-items-center p-6"><div className="max-w-md text-center"><AlertTriangle className="mx-auto size-10 text-destructive"/><h1 className="mt-4 text-2xl font-semibold">Workspace unavailable</h1><p className="mt-3 text-muted-foreground">{error instanceof Error?error.message:'Please try again.'}</p><Button onClick={refresh} className="mt-5"><RefreshCw/> Try again</Button></div></div>;
 function setWorkspaceTab(next:string){setTab(next);void navigate({to:'/dashboard',search:{tab:next}});}
 function choose(id:string){setSelected(id);setWorkspaceTab('overview');}
 const canHandoff=coordinator||delivery?.driver_user_id===data.userId;
 const deadline=active?new Date(active.pickup_deadline).getTime():0;
 return <AppShell name={data.profile?.full_name||'Rescue partner'} role={role} view={tab} onView={setWorkspaceTab}><div className="px-4 py-6 md:px-8 md:py-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="capitalize">{role}</Badge><LiveBadge/></div><h1 className="mt-3 text-3xl font-semibold md:text-4xl">Rescue command center</h1></div><div className="flex gap-2">{coordinator&&<Button asChild variant="outline"><Link to="/memberships">Membership requests</Link></Button>}<Button variant="outline" size="icon" title="Refresh workspace" aria-label="Refresh workspace" disabled={isFetching} onClick={refresh}><RefreshCw className={isFetching?'animate-spin':''}/></Button>{roles.includes('donor')&&<DonationDialog onCreated={refresh}/>}</div></div>
 {demoOnly&&<p role="status" className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border border-signal/30 bg-signal/5 p-3 text-sm"><strong className="font-semibold">Demo mode.</strong><span className="text-muted-foreground">Screens share live over the demo channel, but nothing is saved to the database — closing every tab loses it. Enable Anonymous sign-in under Authentication → Providers to store rescues for real.</span></p>}
 {error&&<p role="alert" className="mt-4 border border-destructive/30 p-3 text-sm text-destructive">Latest refresh failed. Previous records are still shown.</p>}
 <Tabs value={tab} onValueChange={setWorkspaceTab} className="mt-6">
 <TabsContent value="overview" className="mt-6 space-y-6"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([[Scale,'Delivered weight',`${pounds.toLocaleString()} lb`,`${completed.length} completed rescues`],[PackageCheck,'Estimated meals',Math.round(pounds/1.2).toLocaleString(),'1.2 lb per estimated meal'],[Clock3,'Median delivery',median===undefined?'—':`${Math.round(median)} min`,'Pickup to delivery'],[Leaf,'Open rescues',String(available.length),'Saved operational records']] as Array<[LucideIcon,string,string,string]>).map(([Icon,label,value,note])=><article key={label} className="rounded-md border bg-card p-5"><div className="flex justify-between gap-2"><p className="text-sm text-muted-foreground">{label}</p><Icon className="size-4 shrink-0 text-primary"/></div><p className="mt-4 text-3xl font-semibold">{value}</p><p className="mt-2 text-xs text-muted-foreground">{note}</p></article>)}</div>
 {active?<SlideSwap swapKey={active.id}><section className="border-y bg-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><p className="text-xs font-bold uppercase text-primary">Selected rescue</p><h2 className="mt-1 text-2xl font-semibold">{active.title}</h2></div><Badge variant="outline" className={tone[active.status]??''}>{active.status.replaceAll('_',' ')}</Badge></div><div className="grid lg:grid-cols-2"><div className="p-5"><div className="grid grid-cols-2 gap-4 border-b pb-5"><div><p className="text-xs text-muted-foreground">Available weight</p><p className="mt-1 text-2xl font-semibold">{Number(active.pounds)} lb</p></div><div><p className="text-xs text-muted-foreground">Pickup deadline</p><p className="mt-1 text-lg font-semibold">{date(active.pickup_deadline)}</p><p className={`mt-1 text-xs ${deadline<clock?'text-destructive':'text-muted-foreground'}`}>{inactive.includes(active.status)?'Closed rescue':deadline<clock?'Pickup window expired':`${Math.ceil((deadline-clock)/60000)} min remaining`}</p></div></div><p className="mt-4 flex gap-2 text-sm"><MapPin className="size-4 shrink-0 text-primary"/>{active.pickup_address}</p><div className="mt-4 space-y-2 text-sm text-muted-foreground"><p><strong>Storage:</strong> {active.storage_required}</p><p><strong>Allergens:</strong> {active.allergens||'Not provided; confirm with donor'}</p><p><strong>Handling:</strong> {active.notes||'Confirm handling requirements before pickup.'}</p></div><div className="mt-6"><h3 className="font-semibold">Recipient matches</h3>{visibleMatches.length?visibleMatches.map(m=>{const org=data.organizations.find(o=>o.id===m.recipient_org_id);const canRespond=(role==='recipient'||coordinator)&&m.status==='proposed'&&deadline>clock&&['open','matched'].includes(active.status);return <article key={m.id} className="mt-3 border-l-2 border-primary bg-muted/40 p-4"><div className="flex justify-between gap-4"><div><p className="font-semibold">{org?.name??'Recipient'}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{m.status}</p></div><span className="text-xl font-semibold text-primary">{m.score}<span className="text-xs"> /100</span></span></div><p className="mt-3 text-sm leading-6 text-muted-foreground">{m.explanation}</p>{canRespond&&<div className="mt-4 flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={()=>act(m.id,'accept')}><Check/> Accept</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>act(m.id,'decline')}><X/> Decline</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>act(m.id,'unsafe')}><AlertTriangle/> Unsafe</Button></div>}</article>}):<p className="mt-3 text-sm text-muted-foreground">No eligible recipient matches for this rescue.</p>}</div>{accepted&&<Button variant="outline" className="mt-5" onClick={()=>setWorkspaceTab('route')}><Truck/> View delivery</Button>}</div><div className="border-t p-5 lg:border-l lg:border-t-0"><LiveMap points={detailPoints} route={detailRoute}/><p className="mt-3 text-xs text-muted-foreground">Saved pickup and accepted recipient locations. Not a road-navigation route.</p></div></div></section></SlideSwap>:<Empty title="No rescues yet" copy="Posted donations will appear here."/>}
 <RelayBoard rescues={data.donations} statusTone={tone} onOpen={setDetailId}/></TabsContent>
 <TabsContent value="opportunities" className="mt-6 space-y-6">
 <div className="flex flex-wrap items-end justify-between gap-3">
  <div><h2 className="text-2xl font-semibold">Volunteer opportunities</h2><p className="mt-1 text-sm text-muted-foreground">{location.coords?'Sorted by how far each pickup is from you.':'Share your location to sort these by distance.'}</p></div>
  {!location.coords&&<Button variant="outline" size="sm" disabled={location.status==='prompting'} onClick={location.request}><MapPin/> {location.status==='prompting'?'Locating…':'Use my location'}</Button>}
 </div>
 {location.error&&<p role="status" className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{location.error}</p>}
 <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
  <OpportunityBoard opportunities={opportunities} viewer={location.coords} now={clock} canDrive={roles.includes('driver')||coordinator} busy={busy} onOpen={setDetailId} onClaim={id=>{if(!location.coords)location.request();void act(id,'claim');}} userId={data.userId} onDelete={deleteDonation} onRouteChange={run=>{setRouteRun(run);setRouteSummary(null);}}/>
  <div className="space-y-3 xl:sticky xl:top-20 xl:self-start">
   <LiveMap points={routeRun&&routeRun.foodBank?[...(location.coords&&hasPosition(location.coords)?[{id:'viewer-location',lat:location.coords.latitude,lng:location.coords.longitude,label:'Your location',kind:'donor' as const}]:[]),{id:`${routeRun.donationId}-p`,lat:routeRun.pickup.latitude,lng:routeRun.pickup.longitude,label:routeRun.pickupAddress,kind:'donor'},{id:routeRun.foodBank.id,lat:routeRun.foodBank.latitude,lng:routeRun.foodBank.longitude,label:routeRun.foodBank.name,kind:'recipient'}]:allPoints} route={routeRun&&routeRun.foodBank?location.coords&&hasPosition(location.coords)?{origin:{lat:location.coords.latitude,lng:location.coords.longitude},waypoints:[{lat:routeRun.pickup.latitude,lng:routeRun.pickup.longitude}],destination:{lat:routeRun.foodBank.latitude,lng:routeRun.foodBank.longitude}}:{origin:{lat:routeRun.pickup.latitude,lng:routeRun.pickup.longitude},destination:{lat:routeRun.foodBank.latitude,lng:routeRun.foodBank.longitude}}:undefined} onRouteSummary={setRouteSummary}/>
   {routeRun&&routeRun.foodBank?<div className="space-y-3 rounded-md border bg-card p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
     <div className="min-w-0"><p className="truncate text-sm font-medium">{routeRun.title}</p><p className="truncate text-xs text-muted-foreground">to {routeRun.foodBank.name}</p></div>
     <Button variant="ghost" size="sm" onClick={()=>{setRouteRun(null);setRouteSummary(null);}}>Show all</Button>
    </div>
    <p className="text-sm"><Truck className="mr-1.5 inline size-4"/>{routeSummary?<>{routeSummary.distance} · {routeSummary.duration} drive{routeSummary.followsRoads===false&&<span className="text-muted-foreground"> (estimated — routing unavailable)</span>}</>:<span className="text-muted-foreground">Finding the driving route…</span>}</p>
    <div className="flex flex-wrap gap-2">
     <Button asChild variant="outline" size="sm"><a href={directionsUrl(location.coords&&hasPosition(location.coords)?location.coords:routeRun.pickup,{latitude:routeRun.foodBank.latitude,longitude:routeRun.foodBank.longitude},location.coords&&hasPosition(location.coords)?routeRun.pickup:undefined)} target="_blank" rel="noreferrer">Open in Google Maps <ArrowRight/></a></Button>
     <Button asChild variant="outline" size="sm"><a href={appleDirectionsUrl(routeRun.pickup,{latitude:routeRun.foodBank.latitude,longitude:routeRun.foodBank.longitude})} target="_blank" rel="noreferrer">Apple Maps</a></Button>
    </div>
   </div>:<p className="text-xs text-muted-foreground">Every active pickup and food bank you can see. Choose a rescue&rsquo;s route to draw it here.</p>}
  </div>
 </div>
 </TabsContent>
 <TabsContent value="route" className="mt-6"><div className="grid gap-6 xl:grid-cols-2"><LiveMap points={detailPoints} route={detailRoute}/><section>
   {/* Only the detail slides. The list under it is the navigation driving the
       swap, and sliding that out from under the pointer on every click is the
       one thing it must not do. */}
   <SlideSwap swapKey={active?.id??'none'}>{active&&accepted?<><p className="text-xs font-bold uppercase text-primary">{delivery?'Delivery handoff':'Available assignment'}</p><h2 className="mt-2 text-2xl font-semibold">{active.title}</h2><div className="mt-6 space-y-5 border-y py-5"><Stop title="Pickup" detail={active.pickup_address} time={delivery?.picked_up_at}/><Stop title="Delivery" detail={recipient?.name??'Recipient'} time={delivery?.delivered_at}/></div><p className="mt-4 text-sm text-muted-foreground">{Number(active.pounds)} lb · {active.storage_required}</p><p className="mt-3 text-sm">Driver: {delivery?.driver_name||'Not yet assigned'}</p><p className="mt-4 border-l-2 border-info pl-3 text-sm leading-6 text-muted-foreground">Follow your organization’s food-safety policy. Pickup confirmation acknowledges that you checked the handling requirements.</p>{!delivery?.driver_user_id&&!delivery?.picked_up_at&&(role==='driver'||coordinator)&&<Button className="mt-5" disabled={busy||deadline<clock} onClick={()=>{if(!location.coords)location.request();void act(accepted.id,'claim');}}><Truck/> Claim route</Button>}{delivery&&canHandoff&&<div className="mt-5 flex flex-wrap gap-2"><Button disabled={busy||Boolean(delivery.picked_up_at)} onClick={()=>act(delivery.id,'pickup')}><Check/> Confirm safe pickup</Button><Button disabled={busy||!delivery.picked_up_at||Boolean(delivery.delivered_at)} onClick={()=>act(delivery.id,'deliver')}><PackageCheck/> Confirm delivery</Button></div>}{delivery?.driver_user_id&&!canHandoff&&<p className="mt-5 text-sm text-muted-foreground">The assigned driver records this handoff.</p>}</>:<Empty title="No accepted route selected" copy="Choose an accepted rescue from the relay board to view its delivery."/>}</SlideSwap>
   <div className="mt-8 border-t pt-6"><h3 className="font-semibold">Accepted rescues</h3>
    <p className="mt-1 text-sm text-muted-foreground">Pick one to bring its delivery in above.</p>
    <ul className="mt-4 space-y-2">{data.matches.filter(m=>m.status==='accepted').map(m=>{
     const d=data.donations.find(d=>d.id===m.donation_id);
     if(!d)return null;
     const to=data.organizations.find(o=>o.id===m.recipient_org_id)?.name;
     const open=active?.id===d.id;
     return <li key={m.id}>
      <button
       type="button"
       onClick={()=>setSelected(d.id)}
       aria-current={open?'true':undefined}
       className={`group flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${open?'border-primary/40 bg-primary/5':'hover:bg-secondary'}`}
      >
       {/* Marks the open rescue, and grows into place rather than blinking on. */}
       <span aria-hidden="true" className={`h-8 w-1 shrink-0 rounded-full bg-primary transition-transform duration-200 ${open?'scale-y-100':'scale-y-0'}`}/>
       <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{d.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{Number(d.pounds)} lb{to?` · ${to}`:''}</span>
       </span>
       <ArrowRight className={`size-4 shrink-0 transition-transform ${open?'text-primary':'text-muted-foreground group-hover:translate-x-0.5'}`}/>
      </button>
     </li>;
    })}</ul>
   </div>
  </section></div></TabsContent>
 <TabsContent value="partners" className="mt-6"><PartnerDirectory partners={partners} coordinator={coordinator} busy={busy} locationShared={Boolean(location.coords)} locating={location.status==='prompting'} onVerify={changeVerification} onRequestLocation={location.request} viewer={location.coords} summarize={summarizePartnerById}/></TabsContent>
 <TabsContent value="activity" className="mt-6 space-y-10">
 <section>
  {/* Live work and finished work are one section the viewer switches between, so a
      long history never pushes what is still in progress off the screen. */}
  <Tabs value={feed} onValueChange={v=>setFeed(v as RescueActivity['phase'])}>
   <div className="flex flex-wrap items-end justify-between gap-2">
    <TabsList aria-label="Which activities to show">
     <TabsTrigger value="current">Current activities<Count n={activity.current.length}/></TabsTrigger>
     <TabsTrigger value="recent">Recent activities<Count n={activity.recent.length}/></TabsTrigger>
    </TabsList>
    {feed==='current'&&activity.current.length>0&&<p className="text-sm text-muted-foreground">{waitingCount?`${waitingCount} waiting on you`:'Nothing blocked on you'}</p>}
   </div>
   <TabsContent value="current" className="mt-5 space-y-3 duration-200 animate-in fade-in slide-in-from-right-4">{activity.current.length?activity.current.map(a=><ActivityCard key={a.key} activity={a} now={clock} onOpen={choose} onAct={act} busy={busy}/>):<Empty title="No current activities" copy="Claim a route, accept an offer, or post surplus and it will appear here while it is in progress."/>}</TabsContent>
   <TabsContent value="recent" className="mt-5 space-y-3 duration-200 animate-in fade-in slide-in-from-right-4">{activity.recent.length?activity.recent.map(a=><ActivityCard key={a.key} activity={a} now={clock} onOpen={choose} onAct={act} busy={busy}/>):<Empty title="No completed activities yet" copy="Finished rescues move here with the time they were closed."/>}</TabsContent>
  </Tabs>
 </section>
 <section>
  <h2 className="text-xl font-semibold">Network log</h2>
  <p className="mt-1 text-sm text-muted-foreground">Every recorded action on rescues you can see.</p>
  <div className="mt-5 divide-y border-y">{data.events.length?data.events.map(e=><article key={e.id} className="py-5"><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold capitalize">{e.event_type.replaceAll('_',' ')}</p><time className="text-xs text-muted-foreground">{date(e.created_at)}</time></div><p className="mt-2 text-sm text-muted-foreground">{e.detail}</p><Button variant="link" className="mt-1 h-auto px-0 text-xs" onClick={()=>choose(e.donation_id)}>{data.donations.find(d=>d.id===e.donation_id)?.title??'View rescue'} <ArrowRight/></Button></article>):<Empty title="No recorded activity" copy="Rescue actions create a timestamped history here."/>}</div>
 </section>
</TabsContent>
 <TabsContent value="impact" className="mt-6"><h2 className="text-2xl font-semibold">Completed rescue receipts</h2><p className="mt-2 text-sm text-muted-foreground">Recorded weight and handoff times from completed deliveries.</p><div className="mt-6 space-y-6">{completed.length?completed.map(d=>{const m=data.matches.find(m=>m.donation_id===d.id&&m.status==='accepted');const handoff=data.deliveries.find(x=>x.match_id===m?.id);const elapsed=handoff?.delivered_at&&handoff.picked_up_at?Math.round((new Date(handoff.delivered_at).getTime()-new Date(handoff.picked_up_at).getTime())/60000):null;return <article key={d.id} className="rounded-md border bg-card"><div className="bg-primary p-6 text-primary-foreground"><p className="font-mono text-xs">RR-{d.id.slice(0,8).toUpperCase()}</p><h3 className="mt-3 text-2xl font-semibold">{d.title}</h3><p className="mt-2 text-sm text-primary-foreground/75">{data.organizations.find(o=>o.id===d.donor_org_id)?.name??'Food donor'} → {data.organizations.find(o=>o.id===m?.recipient_org_id)?.name??'Recipient'}</p></div><div className="grid gap-6 p-6 sm:grid-cols-3">{[[`${Number(d.pounds)} lb`,'Delivered weight'],[String(Math.round(Number(d.pounds)/1.2)),'Estimated meals'],[elapsed===null?'Not recorded':`${elapsed} min`,'Pickup to delivery']].map(([v,l])=><div key={l}><p className="text-2xl font-semibold">{v}</p><p className="mt-2 text-sm text-muted-foreground">{l}</p></div>)}</div><p className="border-t px-6 py-4 text-xs text-muted-foreground">Meals estimated at 1.2 lb per meal. {handoff?.delivered_at?`Delivery recorded ${date(handoff.delivered_at)}.`:'Delivery timestamps unavailable.'}</p></article>}):<Empty title="No completed rescues yet" copy="Impact receipts appear after a driver confirms delivery."/>}</div></TabsContent>
 </Tabs>
 <RescueDetailDialog rescue={data.donations.find(d=>d.id===detailId)??null} matches={data.matches.filter(m=>m.donation_id===detailId)} organizations={data.organizations} delivery={(()=>{const accepted=data.matches.find(m=>m.donation_id===detailId&&m.status==='accepted');return accepted?data.deliveries.find(x=>x.match_id===accepted.id)??null:null;})()} statusTone={tone} now={clock} onClose={()=>setDetailId('')} onOpenWorkspace={choose}/>
 </div></AppShell>;
}
/** How many entries a list holds, shown on its switch so the hidden one still reports itself. */
function Count({n}:{n:number}){
 if(!n)return null;
 return <span className="ml-2 rounded bg-foreground/10 px-1.5 text-xs tabular-nums">{n}</span>;
}
/** Reports what the connection is actually doing, including how long since the last saved change. */
function LiveBadge(){
 const {status,lastChangeAt,attempts}=useLiveState();
 const [,tick]=useState(0);
 useEffect(()=>{const t=setInterval(()=>tick(v=>v+1),CLOCK_TICK_MS);return()=>clearInterval(t);},[]);
 const live=status==='Live';
 const ago=lastChangeAt?Math.round((Date.now()-lastChangeAt)/1000):null;
 const freshness=ago===null?'awaiting first change':ago<10?'updated just now':ago<90?`updated ${ago}s ago`:`updated ${Math.round(ago/60)}m ago`;
 const detail=live?freshness:status==='Offline'?'signed out':`retry ${attempts} · polling every ${POLL_DEGRADED_MS/1000}s`;
 return <span role="status" className={`text-xs ${live?'text-success':status==='Reconnecting'?'text-destructive':'text-muted-foreground'}`}>
  <span aria-hidden="true">●</span> {live?'Live':status} · {detail}
 </span>;
}
function Stop({title,detail,time}:{title:string;detail:string;time?:string|null|undefined}){return <div className="flex gap-4"><span className={`grid size-8 shrink-0 place-items-center rounded-full border ${time?'bg-success text-success-foreground':'text-primary'}`}>{time?<Check className="size-4"/>:<MapPin className="size-4"/>}</span><div><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-muted-foreground">{detail}</p><p className="mt-1 text-xs text-muted-foreground">{time?date(time):'Awaiting confirmation'}</p></div></div>;}
