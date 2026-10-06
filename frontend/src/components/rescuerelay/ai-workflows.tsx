import { useState, useMemo, useEffect } from 'react';
import {
  Bot,
  Sparkles,
  Share2,
  Send,
  Copy,
  Check,
  Zap,
  Bell,
  HeartHandshake,
  Users,
  MessageSquare,
  Globe,
  Radio,
  Clock3,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Plus,
  Sliders,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface DonationItem {
  id: string;
  title: string;
  pounds: number | string;
  category: string;
  pickup_address: string;
  pickup_deadline: string;
  storage_required: string;
  allergens?: string;
  notes?: string;
  status: string;
}

interface OrganizationItem {
  id: string;
  name: string;
  type: string;
  address: string;
  capacity_lbs?: number;
  accepted_categories?: string[];
  verification_status?: string;
}

interface AiWorkflowsProps {
  data: {
    donations: DonationItem[];
    organizations: OrganizationItem[];
    matches?: Array<{ id: string; donation_id: string; recipient_org_id: string; score: number; status: string }>;
    deliveries?: Array<{ id: string; match_id: string; driver_name: string; delivered_at?: string | null }>;
    profile?: { full_name?: string; organization_id?: string | null };
    roles?: Array<{ role: string }>;
  };
  role: string;
}

interface AgentConfig {
  id: string;
  name: string;
  role: string;
  description: string;
  icon: LucideIcon;
  enabled: boolean;
  tone: 'community' | 'urgent' | 'partner' | 'storyteller';
  channels: string[];
  autoPublish: boolean;
  signoff: string;
}

interface ChannelConfig {
  id: string;
  name: string;
  handle: string;
  platform: 'facebook' | 'instagram' | 'x' | 'sms' | 'webhook';
  connected: boolean;
  autoSync: boolean;
  audience: string;
}

interface BroadcastPost {
  id: string;
  agentId: string;
  agentName: string;
  channel: string;
  rescueTitle: string;
  content: string;
  status: 'published' | 'scheduled' | 'review';
  timestamp: string;
  reach?: string;
}

const DEFAULT_AGENTS: AgentConfig[] = [
  {
    id: 'community-alert',
    name: 'Community Food Alert Agent',
    role: 'Public distribution announcements',
    description: 'Alerts local residents, neighborhood groups, and families when fresh or prepared surplus arrives for free distribution.',
    icon: Bell,
    enabled: true,
    tone: 'community',
    channels: ['Facebook Page', 'Instagram', 'Community SMS'],
    autoPublish: false,
    signoff: 'All are welcome. No ID or paperwork required. First-come, first-served.',
  },
  {
    id: 'perishable-dispatch',
    name: 'Urgent Surplus Alert Bot',
    role: 'Time-critical perishables broadcast',
    description: 'Triggers instant alerts when high-value refrigerated items or prepared meals need to be claimed within 3 hours.',
    icon: Zap,
    enabled: true,
    tone: 'urgent',
    channels: ['X (Twitter)', 'Community SMS', 'Telegram Channel'],
    autoPublish: true,
    signoff: 'Please bring your own cold-totes or containers if possible!',
  },
  {
    id: 'partner-relay',
    name: 'Sister Pantry & Shelter Dispatcher',
    role: 'B2B cross-pantry collaboration',
    description: 'Informs nearby soup kitchens, youth shelters, and mutual aid partners when donations exceed on-site cold storage capacity.',
    icon: Users,
    enabled: true,
    tone: 'partner',
    channels: ['Partner Webhook', '211 Inter-Agency Feed'],
    autoPublish: true,
    signoff: 'Cross-docking and volunteer pickup assistance available on request.',
  },
  {
    id: 'donor-gratitude',
    name: 'Donor Impact & Gratitude Agent',
    role: 'Public recognition & meal impact',
    description: 'Celebrates donors, shares verified rescued meal counts, and inspires local grocers and restaurants to join RescueRelay.',
    icon: HeartHandshake,
    enabled: true,
    tone: 'storyteller',
    channels: ['LinkedIn', 'Facebook Page', 'X (Twitter)'],
    autoPublish: false,
    signoff: 'Together, we make sure good food reaches tables instead of landfills.',
  },
];

const DEFAULT_CHANNELS: ChannelConfig[] = [
  { id: 'fb', name: 'Facebook Page & Groups', handle: '@DesMoinesFoodBankCommunity', platform: 'facebook', connected: true, autoSync: true, audience: '3.4k local followers' },
  { id: 'insta', name: 'Instagram & Stories', handle: '@hopepantry_dsm', platform: 'instagram', connected: true, autoSync: true, audience: '1.9k community members' },
  { id: 'x', name: 'X / Twitter Broadcast', handle: '@RescueRelayDSM', platform: 'x', connected: true, autoSync: true, audience: '850 partners & volunteers' },
  { id: 'sms', name: 'Community SMS Hotlines', handle: 'Twilio Relay · 515-555-FOOD', platform: 'sms', connected: true, autoSync: true, audience: '420 registered households' },
  { id: 'webhook', name: 'Sister Pantry JSON Webhook', handle: 'api.rescuerelay.org/v1/feed', platform: 'webhook', connected: true, autoSync: true, audience: '12 verified partner shelters' },
];

export function AiWorkflows({ data, role }: AiWorkflowsProps) {
  const [agents, setAgents] = useState<AgentConfig[]>(() => {
    try {
      const saved = localStorage.getItem('rr_ai_agents');
      return saved ? JSON.parse(saved) : DEFAULT_AGENTS;
    } catch {
      return DEFAULT_AGENTS;
    }
  });

  const [channels, setChannels] = useState<ChannelConfig[]>(() => {
    try {
      const saved = localStorage.getItem('rr_ai_channels');
      return saved ? JSON.parse(saved) : DEFAULT_CHANNELS;
    } catch {
      return DEFAULT_CHANNELS;
    }
  });

  const [posts, setPosts] = useState<BroadcastPost[]>(() => {
    const saved = localStorage.getItem('rr_ai_posts');
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return [
      {
        id: 'post-1',
        agentId: 'community-alert',
        agentName: 'Community Food Alert Agent',
        channel: 'Facebook & Instagram',
        rescueTitle: '150 lb Fresh Prepared Meals from Capitol Fresh Market',
        content: '📢 FRESH FOOD ALERT in Des Moines! Thanks to Capitol Fresh Market, we have just received 150 lbs of fresh, chef-prepared refrigerated meals (approx. 125 meals) at Hope Community Pantry!\n\n📍 Distribution starts at 2:00 PM today at 1200 Grand Ave.\nFree and open to everyone in our community. First-come, first-served. Please share with neighbors!',
        status: 'published',
        timestamp: 'Today at 1:15 PM',
        reach: '640 people reached · 28 shares',
      },
      {
        id: 'post-2',
        agentId: 'partner-relay',
        agentName: 'Sister Pantry & Shelter Dispatcher',
        channel: 'Partner Webhook',
        rescueTitle: 'Cross-docking alert: 80 lb dairy & bakery surplus',
        content: '🤝 PARTNER ALERT: 80 lbs of safe bakery & dairy surplus incoming from Downtown Grocers. Hope Pantry has 40 lbs spare cold capacity. Any sister shelter with immediate intake availability, please claim via RescueRelay or reply to dispatch.',
        status: 'published',
        timestamp: 'Today at 11:30 AM',
        reach: 'Delivered to 12 partner shelters',
      },
    ];
  });

  // Generator state
  const [selectedRescueId, setSelectedRescueId] = useState<string>(data.donations[0]?.id || '');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('community-alert');
  const [targetPlatform, setTargetPlatform] = useState<string>('facebook');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [generatedDraft, setGeneratedDraft] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'agents' | 'generator' | 'channels' | 'history'>('agents');

  // Automation triggers state
  const [triggerOnAccept, setTriggerOnAccept] = useState(true);
  const [triggerOnDelivery, setTriggerOnDelivery] = useState(true);
  const [triggerOnUrgent, setTriggerOnUrgent] = useState(true);
  const [requireApproval, setRequireApproval] = useState(true);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('rr_ai_agents', JSON.stringify(agents));
  }, [agents]);

  useEffect(() => {
    localStorage.setItem('rr_ai_channels', JSON.stringify(channels));
  }, [channels]);

  useEffect(() => {
    localStorage.setItem('rr_ai_posts', JSON.stringify(posts));
  }, [posts]);

  // Selected rescue object
  const activeRescue = useMemo(() => {
    return data.donations.find((d) => d.id === selectedRescueId) || data.donations[0];
  }, [data.donations, selectedRescueId]);

  const activeAgent = useMemo(() => {
    return agents.find((a) => a.id === selectedAgentId) || agents[0];
  }, [agents, selectedAgentId]);

  // Generate AI copy function
  const handleGenerate = () => {
    if (!activeRescue) {
      toast.error('No rescue selected to generate broadcast from.');
      return;
    }

    setIsGenerating(true);
    setTimeout(() => {
      const pounds = Number(activeRescue.pounds);
      const meals = Math.round(pounds / 1.2);
      const deadlineDate = new Date(activeRescue.pickup_deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const donorName = 'Capitol Fresh Market'; // Illustrative donor partner
      const pantryName = data.profile?.organization_id 
        ? data.organizations.find(o => o.id === data.profile?.organization_id)?.name || 'Community Food Pantry'
        : 'Hope Community Pantry';

      let text = '';
      if (selectedAgentId === 'community-alert') {
        text = `🥕 FRESH FOOD DISTRIBUTION TODAY | ${pantryName}\n\n` +
          `We just secured ${pounds.toLocaleString()} lbs of ${activeRescue.category} (${meals} estimated nourishing meals) through RescueRelay!\n\n` +
          `📍 Location: ${activeRescue.pickup_address}\n` +
          `⏰ Distribution Hours: Today from 2:00 PM until supplies last (pickup window through ${deadlineDate})\n` +
          `❄️ Storage: ${activeRescue.storage_required === 'refrigerated' ? 'Refrigerated & fresh' : activeRescue.storage_required === 'frozen' ? 'Frozen' : 'Ambient shelf-stable'}\n` +
          (activeRescue.allergens ? `⚠️ Allergen info: ${activeRescue.allergens}\n\n` : '\n') +
          `${activeAgent.signoff}\n\n` +
          `#FoodRescue #DesMoinesCommunity #RescueRelay #ZeroFoodWaste #MutualAid`;
      } else if (selectedAgentId === 'perishable-dispatch') {
        text = `🚨 URGENT SURPLUS BROADCAST — ${pounds} LBS AVAILABLE NOW\n\n` +
          `Time-sensitive rescue alert: ${activeRescue.title} (${pounds} lbs, ${activeRescue.category}) ready for urgent pickup before ${deadlineDate}!\n\n` +
          `• Safe food handling verified\n` +
          `• Direct pickup address: ${activeRescue.pickup_address}\n` +
          `• Best for: Immediate distribution to families, shelters, or hot meal programs.\n\n` +
          `${activeAgent.signoff}\n\n` +
          `#UrgentSurplus #RescueRelay #CommunityAction #ImmediatePickup`;
      } else if (selectedAgentId === 'partner-relay') {
        text = `🤝 PARTNER NETWORK DISPATCH [Automated B2B Relay]\n\n` +
          `To all partner pantries & meal sites in Des Moines:\n` +
          `A new rescue of ${pounds} lbs (${activeRescue.category}) has been logged in RescueRelay.\n` +
          `Pickup location: ${activeRescue.pickup_address}\n` +
          `Deadline: ${deadlineDate} | Cold storage req: ${activeRescue.storage_required}\n\n` +
          `If your pantry has excess capacity or requires surplus re-routing, coordinate on RescueRelay or contact dispatch.\n` +
          `${activeAgent.signoff}`;
      } else {
        text = `💚 RESCUE IMPACT SPOTLIGHT\n\n` +
          `Gratitude to our amazing partners! Today, ${pounds} lbs of nutritious ${activeRescue.category} were redirected from waste into ${meals} wholesome meals for local families.\n\n` +
          `Every pound rescued represents food security, climate impact, and neighborhood solidarity.\n\n` +
          `${activeAgent.signoff}\n\n` +
          `#FoodHero #RescueRelay #SustainableCommunities #DesMoines`;
      }

      if (customPrompt.trim()) {
        text += `\n\n📝 Note: ${customPrompt.trim()}`;
      }

      setGeneratedDraft(text);
      setIsGenerating(false);
      toast.success(`Generated broadcast using ${activeAgent.name}`);
    }, 600);
  };

  const handlePublishNow = () => {
    if (!generatedDraft) {
      toast.error('Generate or type a broadcast message first.');
      return;
    }

    const newPost: BroadcastPost = {
      id: `post-${Date.now()}`,
      agentId: selectedAgentId,
      agentName: activeAgent.name,
      channel: targetPlatform.toUpperCase(),
      rescueTitle: activeRescue ? `${activeRescue.pounds} lb ${activeRescue.title}` : 'Community Broadcast',
      content: generatedDraft,
      status: 'published',
      timestamp: 'Just now',
      reach: 'Broadcasting to connected channels',
    };

    setPosts([newPost, ...posts]);
    toast.success('Broadcast published to connected channels successfully!');
    setActiveTab('history');
  };

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success('Broadcast text copied to clipboard!');
  };

  const toggleAgent = (id: string) => {
    setAgents(agents.map(a => (a.id === id ? { ...a, enabled: !a.enabled } : a)));
    const target = agents.find(a => a.id === id);
    toast.info(`${target?.name} ${!target?.enabled ? 'activated' : 'paused'}`);
  };

  const toggleChannel = (id: string) => {
    setChannels(channels.map(c => (c.id === id ? { ...c, connected: !c.connected } : c)));
    const target = channels.find(c => c.id === id);
    toast.info(`${target?.name} ${!target?.connected ? 'connected' : 'disconnected'}`);
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="rounded-md border bg-card p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Bot className="size-4" />
              </span>
              <p className="text-xs font-bold uppercase tracking-wider text-primary">Automated Partner Relay</p>
              <Badge variant="outline" className="border-signal/30 bg-signal/10 text-signal-strong">
                AI Powered
              </Badge>
            </div>
            <h2 className="mt-2 text-2xl font-semibold md:text-3xl">AI Social & Broadcast Workflows</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Empower food banks, distribution centers, and shelters to automate social media, public alerts, and partner dispatches in real time.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                setActiveTab('generator');
                if (!generatedDraft) handleGenerate();
              }}
              className="gap-2"
            >
              <Sparkles className="size-4" />
              Instant Broadcast Composer
            </Button>
          </div>
        </div>

        {/* Quick Metrics Bar */}
        <div className="mt-6 grid grid-cols-2 gap-3 border-t pt-5 sm:grid-cols-4">
          <div className="rounded border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Active AI Agents</p>
            <p className="mt-1 text-xl font-semibold text-primary">
              {agents.filter((a) => a.enabled).length} / {agents.length}
            </p>
            <p className="text-[11px] text-muted-foreground">Autonomous dispatches</p>
          </div>
          <div className="rounded border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Connected Channels</p>
            <p className="mt-1 text-xl font-semibold text-primary">
              {channels.filter((c) => c.connected).length} / {channels.length}
            </p>
            <p className="text-[11px] text-muted-foreground">Social, SMS & Webhook</p>
          </div>
          <div className="rounded border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Broadcasts Sent</p>
            <p className="mt-1 text-xl font-semibold text-primary">{posts.length}</p>
            <p className="text-[11px] text-muted-foreground">Real-time alerts logged</p>
          </div>
          <div className="rounded border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Community Reach</p>
            <p className="mt-1 text-xl font-semibold text-primary">6,500+</p>
            <p className="text-[11px] text-muted-foreground">Local residents & shelters</p>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b">
        {[
          { key: 'agents', label: 'AI Agents Fleet', icon: Bot },
          { key: 'generator', label: 'Live Broadcast Composer', icon: Sparkles },
          { key: 'channels', label: 'Social & Feed Channels', icon: Share2 },
          { key: 'history', label: 'Broadcast Log & Outbox', icon: Radio },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as typeof activeTab)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {/* TAB 1: AI AGENTS */}
      {activeTab === 'agents' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">Built-In Distribution AI Agents</h3>
              <p className="text-sm text-muted-foreground">
                Each agent monitors incoming food rescues and coordinates specialized communication automatically.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Automated workflow safeguards enabled</span>
              <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                Food Safety Verified
              </Badge>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {agents.map((agent) => {
              const Icon = agent.icon;
              return (
                <article
                  key={agent.id}
                  className={`relative rounded-md border bg-card p-5 transition ${
                    agent.enabled ? 'border-primary/40 ring-1 ring-primary/20' : 'opacity-80'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex size-10 shrink-0 items-center justify-center rounded-md ${
                          agent.enabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        <Icon className="size-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold">{agent.name}</h4>
                          <Badge
                            variant="outline"
                            className={
                              agent.enabled
                                ? 'border-success/20 bg-success/10 text-success text-[11px]'
                                : 'bg-muted text-muted-foreground text-[11px]'
                            }
                          >
                            {agent.enabled ? 'Active' : 'Paused'}
                          </Badge>
                        </div>
                        <p className="text-xs font-medium text-primary mt-0.5">{agent.role}</p>
                      </div>
                    </div>
                    <Switch
                      checked={agent.enabled}
                      onCheckedChange={() => toggleAgent(agent.id)}
                      aria-label={`Toggle ${agent.name}`}
                    />
                  </div>

                  <p className="mt-4 text-sm leading-6 text-muted-foreground">{agent.description}</p>

                  <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t pt-3">
                    <span className="text-xs text-muted-foreground mr-1">Broadcasts to:</span>
                    {agent.channels.map((ch) => (
                      <Badge key={ch} variant="secondary" className="text-[11px]">
                        {ch}
                      </Badge>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Mode: <strong>{agent.autoPublish ? 'Instant Publish' : 'Human Approval Required'}</strong>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-primary"
                      onClick={() => {
                        setSelectedAgentId(agent.id);
                        setActiveTab('generator');
                        handleGenerate();
                      }}
                    >
                      Draft with this agent <ChevronRight className="size-3" />
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Automation Rules Card */}
          <section className="rounded-md border bg-card p-6">
            <div className="flex items-center gap-2">
              <Sliders className="size-5 text-primary" />
              <h3 className="text-lg font-semibold">Distribution Automation Triggers</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Configure real-time event triggers to let AI agents broadcast announcements automatically.
            </p>

            <div className="mt-5 divide-y border-y">
              <div className="flex items-center justify-between py-4">
                <div>
                  <p className="text-sm font-medium">Auto-draft announcement on rescue accepted</p>
                  <p className="text-xs text-muted-foreground">
                    Generates a pending community broadcast draft whenever your food pantry accepts an incoming rescue.
                  </p>
                </div>
                <Switch checked={triggerOnAccept} onCheckedChange={setTriggerOnAccept} />
              </div>

              <div className="flex items-center justify-between py-4">
                <div>
                  <p className="text-sm font-medium">Broadcast arrival alert when driver completes delivery</p>
                  <p className="text-xs text-muted-foreground">
                    Notifies neighborhood families that food is officially on site and ready for pickup.
                  </p>
                </div>
                <Switch checked={triggerOnDelivery} onCheckedChange={setTriggerOnDelivery} />
              </div>

              <div className="flex items-center justify-between py-4">
                <div>
                  <p className="text-sm font-medium">Emergency perishable alert for short-deadline items (&lt; 3 hours)</p>
                  <p className="text-xs text-muted-foreground">
                    Fires urgent SMS and Twitter blasts so prepared meals and dairy are claimed immediately before expiration.
                  </p>
                </div>
                <Switch checked={triggerOnUrgent} onCheckedChange={setTriggerOnUrgent} />
              </div>

              <div className="flex items-center justify-between py-4">
                <div>
                  <p className="text-sm font-medium">Require pantry coordinator approval before public publishing</p>
                  <p className="text-xs text-muted-foreground">
                    Ensures an authorized volunteer or staff member reviews and approves AI copy before it posts to public social feeds.
                  </p>
                </div>
                <Switch checked={requireApproval} onCheckedChange={setRequireApproval} />
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: LIVE BROADCAST COMPOSER */}
      {activeTab === 'generator' && (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4 rounded-md border bg-card p-6">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="size-5 text-primary" />
                <h3 className="text-xl font-semibold">AI Broadcast Composer</h3>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Synthesize live rescue metrics, storage rules, and location info into authentic community announcements.
              </p>
            </div>

            <div className="space-y-4 pt-2">
              <div>
                <Label htmlFor="rescue-select" className="text-xs font-semibold">
                  Select Live Rescue Record
                </Label>
                <Select value={selectedRescueId} onValueChange={setSelectedRescueId}>
                  <SelectTrigger id="rescue-select" className="mt-1.5">
                    <SelectValue placeholder="Choose a rescue..." />
                  </SelectTrigger>
                  <SelectContent>
                    {data.donations.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.title} ({Number(d.pounds)} lb · {d.category})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {activeRescue && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    📍 {activeRescue.pickup_address} · {activeRescue.storage_required} storage · Status: {activeRescue.status}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-semibold">AI Agent Pipeline</Label>
                  <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs font-semibold">Target Platform</Label>
                  <Select value={targetPlatform} onValueChange={setTargetPlatform}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="facebook">Facebook Page / Group</SelectItem>
                      <SelectItem value="instagram">Instagram Feed / Story</SelectItem>
                      <SelectItem value="x">X / Twitter</SelectItem>
                      <SelectItem value="sms">Community SMS Hotline</SelectItem>
                      <SelectItem value="webhook">Sister Pantry Webhook</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="custom-notes" className="text-xs font-semibold">
                  Custom Instructions or Distribution Notes (Optional)
                </Label>
                <Input
                  id="custom-notes"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="e.g. Bring tote bags, pickup starts at 3pm, diapers also available"
                  className="mt-1.5"
                />
              </div>

              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full gap-2"
                size="lg"
              >
                <Sparkles className={`size-4 ${isGenerating ? 'animate-spin' : ''}`} />
                {isGenerating ? 'AI Generating Broadcast...' : 'Generate AI Announcement'}
              </Button>
            </div>

            {/* Editable Generated Copy */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Broadcast Content</Label>
                {generatedDraft && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => handleCopy(generatedDraft)}
                  >
                    <Copy className="size-3" /> Copy
                  </Button>
                )}
              </div>
              <Textarea
                value={generatedDraft}
                onChange={(e) => setGeneratedDraft(e.target.value)}
                rows={8}
                placeholder="Click 'Generate AI Announcement' above to compose automatically from live rescue data..."
                className="mt-1.5 text-sm font-sans leading-relaxed"
              />
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => handleGenerate()} disabled={isGenerating}>
                  <RefreshCw className="size-4" /> Regenerate
                </Button>
                <Button onClick={handlePublishNow} className="gap-2">
                  <Send className="size-4" /> Publish to {targetPlatform.toUpperCase()}
                </Button>
              </div>
            </div>
          </div>

          {/* Right Column: Live Mockup Social Preview */}
          <div className="space-y-4">
            <div className="rounded-md border bg-card p-5">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">Live Social Feed Preview</h4>
                <Badge variant="outline" className="capitalize text-xs">
                  {targetPlatform} Mockup
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                How this will appear to neighborhood community members and volunteers.
              </p>

              {/* Feed Preview Box */}
              <div className="mt-4 rounded-lg border bg-background p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">
                    HP
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Hope Community Pantry</p>
                    <p className="text-[11px] text-muted-foreground">
                      Just now · Automated by RescueRelay AI
                    </p>
                  </div>
                </div>

                <div className="mt-3 whitespace-pre-wrap text-sm leading-6">
                  {generatedDraft || (
                    <span className="italic text-muted-foreground">
                      No broadcast generated yet. Select a rescue and click Generate to see live preview.
                    </span>
                  )}
                </div>

                {activeRescue && (
                  <div className="mt-4 overflow-hidden rounded-md border bg-muted/40">
                    <div className="bg-primary/10 p-3 border-b border-primary/20 flex items-center justify-between">
                      <span className="text-xs font-semibold text-primary">RescueRelay Verified Dispatch</span>
                      <span className="text-xs font-mono">{Number(activeRescue.pounds)} LB RESCUE</span>
                    </div>
                    <div className="p-3 text-xs text-muted-foreground space-y-1">
                      <p><strong>Available:</strong> {activeRescue.title}</p>
                      <p><strong>Handling:</strong> {activeRescue.storage_required} condition</p>
                      <p><strong>Pickup Stop:</strong> {activeRescue.pickup_address}</p>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                  <span>❤️ 42 Likes</span>
                  <span>💬 9 Comments</span>
                  <span>🔁 18 Shares</span>
                </div>
              </div>
            </div>

            {/* Quick Tips */}
            <div className="rounded-md border border-signal/30 bg-signal/5 p-4 text-xs text-muted-foreground leading-relaxed">
              <p className="font-semibold text-signal-strong flex items-center gap-1.5">
                <ShieldCheck className="size-4" /> Food Safety Disclaimer Included
              </p>
              <p className="mt-1">
                All AI-generated broadcasts automatically adhere to public food safety standards, including storage condition reminders and allergen disclosures.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: SOCIAL & FEED CHANNELS */}
      {activeTab === 'channels' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">Connected Social & Distribution Channels</h3>
              <p className="text-sm text-muted-foreground">
                Manage where your food distribution center pushes automated rescue announcements.
              </p>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="size-4" /> Connect New Channel
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Connect Distribution Channel</DialogTitle>
                  <DialogDescription>
                    Add a social media profile, webhook, or community SMS provider.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <Label>Channel Type</Label>
                    <Select defaultValue="instagram">
                      <SelectTrigger className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="instagram">Instagram Page</SelectItem>
                        <SelectItem value="facebook">Facebook Group</SelectItem>
                        <SelectItem value="x">X / Twitter Account</SelectItem>
                        <SelectItem value="sms">Twilio SMS Gateway</SelectItem>
                        <SelectItem value="webhook">Custom Webhook / RSS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Account Handle or Webhook URL</Label>
                    <Input placeholder="@community_pantry or https://..." className="mt-1.5" />
                  </div>
                  <Button
                    onClick={() => {
                      toast.success('Channel connected successfully!');
                    }}
                    className="w-full mt-2"
                  >
                    Authorize & Save Connection
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {channels.map((ch) => (
              <article key={ch.id} className="rounded-md border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                      {ch.platform === 'facebook' && <Globe className="size-5" />}
                      {ch.platform === 'instagram' && <Share2 className="size-5" />}
                      {ch.platform === 'x' && <Radio className="size-5" />}
                      {ch.platform === 'sms' && <MessageSquare className="size-5" />}
                      {ch.platform === 'webhook' && <ExternalLink className="size-5" />}
                    </div>
                    <div>
                      <h4 className="font-semibold">{ch.name}</h4>
                      <p className="font-mono text-xs text-muted-foreground">{ch.handle}</p>
                    </div>
                  </div>
                  <Switch
                    checked={ch.connected}
                    onCheckedChange={() => toggleChannel(ch.id)}
                    aria-label={`Toggle ${ch.name}`}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                  <span>Audience: <strong>{ch.audience}</strong></span>
                  <Badge
                    variant="outline"
                    className={
                      ch.connected
                        ? 'border-success/20 bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                    }
                  >
                    {ch.connected ? 'Connected' : 'Disconnected'}
                  </Badge>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: BROADCAST LOG & OUTBOX */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">Broadcast Activity & Outbox</h3>
              <p className="text-sm text-muted-foreground">
                History of automated and manual announcements distributed across channels.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setActiveTab('generator');
                handleGenerate();
              }}
              className="gap-1.5"
            >
              <Plus className="size-3.5" /> Compose New
            </Button>
          </div>

          <div className="divide-y border-y">
            {posts.map((post) => (
              <article key={post.id} className="py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-primary/30 text-primary">
                      {post.agentName}
                    </Badge>
                    <span className="text-xs text-muted-foreground">via {post.channel}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <time className="text-xs text-muted-foreground">{post.timestamp}</time>
                    <Badge
                      variant="outline"
                      className={
                        post.status === 'published'
                          ? 'border-success/20 bg-success/10 text-success'
                          : 'border-signal/20 bg-signal/10 text-signal-strong'
                      }
                    >
                      {post.status}
                    </Badge>
                  </div>
                </div>

                <p className="mt-2 text-sm font-semibold">{post.rescueTitle}</p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {post.content}
                </p>

                <div className="mt-3 flex items-center justify-between border-t border-muted pt-2 text-xs text-muted-foreground">
                  <span>{post.reach || 'Broadcast active'}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs"
                    onClick={() => handleCopy(post.content)}
                  >
                    <Copy className="size-3" /> Copy Text
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

