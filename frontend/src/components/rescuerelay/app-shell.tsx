import { useNavigate } from '@tanstack/react-router';
import { Activity, Bot, LayoutDashboard, LogOut, Route as RouteIcon, Users, Leaf, type LucideIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { Brand } from './brand';
import { Button } from '@/components/ui/button';
export function AppShell({children,name='Rescue partner',view,onView}:{children:React.ReactNode;name?:string;view:string;onView:(view:string)=>void}){
 const navigate=useNavigate();const queryClient=useQueryClient();
 async function signOut(){await queryClient.cancelQueries();queryClient.clear();await supabase.auth.signOut();await navigate({to:'/auth',replace:true});}
 const items:Array<[LucideIcon,string,string]>=[[LayoutDashboard,'Overview','overview'],[LayoutDashboard,'Opportunities','opportunities'],[RouteIcon,'Driver routes','route'],[Bot,'AI Workflows','workflows'],[Users,'Partners','partners'],[Activity,'Activity','activity'],[Leaf,'Impact','impact']];
 return <div className="min-h-screen bg-background lg:grid lg:grid-cols-[248px_1fr]"><aside className="hidden border-r bg-foreground px-5 py-6 text-background lg:flex lg:flex-col"><Brand inverse/><nav aria-label="Workspace navigation" className="mt-10 space-y-1">{items.map(([Icon,label,value])=><Button key={value} variant="ghost" aria-current={view===value?'page':undefined} className={`h-11 w-full justify-start ${view===value?'bg-background/12 text-background':'text-background/65'} hover:bg-background/10 hover:text-background`} onClick={()=>onView(value)}><Icon/>{label}</Button>)}</nav><p className="mt-auto border-t border-background/15 pt-5 text-xs leading-6 text-background/60">Central Iowa pilot<br/>Food safety comes first.</p></aside><div className="min-w-0"><header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:px-8"><div className="lg:hidden"><Brand/></div><div className="hidden lg:block"><p className="text-sm font-semibold">Welcome, {name.split(' ')[0]}</p><p className="text-xs text-muted-foreground">Des Moines rescue network</p></div><Button variant="outline" size="sm" onClick={signOut}><LogOut/> Sign out</Button></header><main>{children}</main></div></div>;
}
