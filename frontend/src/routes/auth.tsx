import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { usePartnerAuth } from '@/lib/auth-context';
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Brand } from "@/components/rescuerelay/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [
    { title: "Sign in — RescueRelay" }, { name: "description", content: "Sign in or create a RescueRelay partner account." },
    { property: "og:title", content: "RescueRelay partner access" }, { property: "og:description", content: "Secure access for food donors, recipient nonprofits, volunteer drivers, and coordinators." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ]}), component: AuthPage,
});

function AuthPage() {
  const {user, loading, recovery} = usePartnerAuth();
  const navigate = useNavigate(); const [mode,setMode]=useState<'signin'|'signup'|'forgot'>('signin'); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [show,setShow]=useState(false); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [pending,setPending]=useState('');
  useEffect(() => { if (!loading && user && !recovery) void navigate({to:'/dashboard',replace:true}); }, [user,loading,recovery,navigate]);
  async function submit(event: React.FormEvent){event.preventDefault();setBusy(true);setMessage('');
    try {
    if(mode==='forgot'){const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${window.location.origin}/reset-password`});setMessage(error?.message??'Check your email for a secure reset link.');setBusy(false);return;}
    const result=mode==='signup'?await supabase.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:`${window.location.origin}/auth`}}):await supabase.auth.signInWithPassword({email:email.trim(),password});
    if(result.error){
      // The project requires email confirmation: say so plainly and offer the resend instead of a dead end.
      if(result.error.code==='email_not_confirmed'){setPending(email.trim());setMessage('This account still needs email confirmation before you can sign in.');}
      else setMessage(result.error.message);
    }
    else if(mode==='signup'&&!result.data.session){setPending(email.trim());setMessage('Account created. Confirm your email address to activate it, then sign in.');}
    else {setPending('');await navigate({to:'/dashboard',replace:true});}
    } catch(err) { setMessage(err instanceof Error ? err.message : 'Unable to connect. Please try again.'); } finally { setBusy(false); }
  }
  async function resend(){setBusy(true);try{const {error}=await supabase.auth.resend({type:'signup',email:pending,options:{emailRedirectTo:`${window.location.origin}/auth`}});setMessage(error?error.message:`Confirmation email re-sent to ${pending}. It can take a minute to arrive.`);}catch(err){setMessage(err instanceof Error?err.message:'Could not resend the confirmation email.');}finally{setBusy(false);}}
  async function google(){setBusy(true);setMessage('');try{const result=await lovable.auth.signInWithOAuth('google',{redirect_uri:window.location.origin});if(result.error)throw result.error;if(!result.redirected) await navigate({to:'/dashboard',replace:true});}catch(err){setMessage(err instanceof Error?err.message:'Google sign-in failed. Try again.');}finally{setBusy(false);}}
  return <div className="min-h-screen bg-muted/40 md:grid md:grid-cols-[1fr_1.05fr]">
    <div className="flex min-h-screen flex-col px-5 py-6 md:px-12"><div className="flex items-center justify-between"><Brand/><Button asChild variant="ghost" size="sm"><Link to="/"><ArrowLeft/> Home</Link></Button></div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12"><p className="text-sm font-bold uppercase text-primary">Partner network</p><h1 className="mt-3 text-4xl font-semibold">{mode==='signin'?'Welcome back':mode==='signup'?'Join RescueRelay':'Reset your password'}</h1><p className="mt-3 text-muted-foreground">{mode==='signup'?'Create a verified partner profile in a few steps.':'Coordinate safe food rescue from one secure workspace.'}</p>
        {mode!=='forgot'&&<Button onClick={google} variant="outline" className="mt-8 h-11" disabled={busy}><span className="font-bold text-primary">G</span> Continue with Google</Button>}
        {mode!=='forgot'&&<div className="my-6 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border"/>OR CONTINUE WITH EMAIL<span className="h-px flex-1 bg-border"/></div>}
        <form onSubmit={submit} className="space-y-4"><div><Label htmlFor="email">Work email</Label><Input id="email" type="email" autoComplete="email" required maxLength={255} value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 h-11" placeholder="you@organization.org"/></div>{mode!=='forgot'&&<div><Label htmlFor="password">Password</Label><div className="relative mt-1"><Input id="password" type={show?'text':'password'} autoComplete={mode==='signin'?'current-password':'new-password'} required minLength={8} maxLength={72} value={password} onChange={e=>setPassword(e.target.value)} className="h-11 pr-11"/><Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1" onClick={()=>setShow(!show)} aria-label={show?'Hide password':'Show password'}>{show?<EyeOff/>:<Eye/>}</Button></div></div>}
          {message&&<div className="rounded-md border bg-background p-3 text-sm" role="status"><p>{message}</p>{pending&&<Button type="button" variant="link" className="mt-1 h-auto px-0" disabled={busy} onClick={resend}>Resend confirmation email</Button>}</div>}<Button className="h-11 w-full" disabled={busy}>{busy?'Please wait…':mode==='signin'?'Sign in':mode==='signup'?'Create account':'Send reset link'}</Button></form>
        <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm"><Button variant="link" className="px-0" disabled={busy} onClick={()=>{setMode(mode==='signup'?'signin':'signup');setMessage('');}}>{mode==='signup'?'Already have an account?':'Create an account'}</Button><Button variant="link" className="px-0 text-muted-foreground" disabled={busy} onClick={()=>{setMode(mode==='forgot'?'signin':'forgot');setMessage('');}}>{mode==='forgot'?'Back to sign in':'Forgot password?'}</Button></div>
      </div>
    </div><div className="relative hidden overflow-hidden bg-primary md:block"><img src={heroImage} alt="Prepared meals transferred safely to a nonprofit" className="absolute inset-0 size-full object-cover"/><div className="absolute inset-0 bg-auth-overlay"/><blockquote className="absolute bottom-12 left-12 right-12 text-primary-foreground"><p className="max-w-lg text-3xl font-semibold leading-tight">“One accountable handoff can turn 150 pounds of surplus into 125 meals.”</p><footer className="mt-4 text-sm text-primary-foreground/70">Central Iowa pilot scenario</footer></blockquote></div>
  </div>
}
import heroImage from "@/assets/rescuerelay-hero.jpg";
