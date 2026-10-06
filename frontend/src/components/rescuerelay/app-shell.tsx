import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  LayoutDashboard,
  Leaf,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Package,
  Route as RouteIcon,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useLiveState } from "@/lib/live-sync";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type NavItem = { icon: LucideIcon; label: string; value: string; hint: string };
type NavGroup = { heading: string; items: NavItem[] };

/** Grouped so the sidebar reads as three jobs rather than one undifferentiated list. */
const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Dispatch",
    items: [
      {
        icon: LayoutDashboard,
        label: "Overview",
        value: "overview",
        hint: "The rescue you are working on",
      },
      {
        icon: Package,
        label: "Opportunities",
        value: "opportunities",
        hint: "Runs open to volunteers",
      },
      {
        icon: RouteIcon,
        label: "Driver routes",
        value: "route",
        hint: "Pickup and drop-off handoffs",
      },
    ],
  },
  {
    heading: "Network",
    items: [
      { icon: Users, label: "Partners", value: "partners", hint: "Food banks and donors" },
      {
        icon: Activity,
        label: "Activity",
        value: "activity",
        hint: "Your current and recent work",
      },
      { icon: Leaf, label: "Impact", value: "impact", hint: "Completed rescue receipts" },
    ],
  },
  {
    heading: "Automation",
    items: [
      {
        icon: Bot,
        label: "AI Workflows",
        value: "workflows",
        hint: "Agent broadcasts to partners",
      },
    ],
  },
];

const COLLAPSE_KEY = "rescuerelay-sidebar-collapsed";

const VIEW_SUBTITLES: Record<string, string> = {
  overview: "The rescue you are working on",
  opportunities: "Runs open to volunteers near you",
  route: "Pickup and drop-off handoffs",
  partners: "Food banks and donors in the network",
  activity: "Your current and recent work",
  impact: "Completed rescue receipts",
  workflows: "Agent broadcasts to partners",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "RR";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "RR";
}

/** The dot beside the workspace title, reporting what the realtime channel is doing. */
function ConnectionDot() {
  const { status } = useLiveState();
  const live = status === "Live";
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      title={live ? "Receiving live updates" : `Realtime ${status.toLowerCase()}`}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          live
            ? "bg-success"
            : status === "Reconnecting"
              ? "bg-destructive"
              : "bg-muted-foreground/50",
        )}
      />
      <span className="hidden sm:inline">{live ? "Live" : status}</span>
    </span>
  );
}

function NavButton({
  item,
  active,
  collapsed,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
}) {
  const button = (
    <Button
      variant="ghost"
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={cn(
        "h-10 w-full gap-3 rounded-md text-sm font-medium transition-colors",
        collapsed ? "justify-center px-0" : "justify-start px-3",
        active
          ? "bg-background/15 text-background hover:bg-background/20 hover:text-background"
          : "text-background/65 hover:bg-background/10 hover:text-background",
      )}
    >
      <item.icon className="size-4 shrink-0" />
      {/* Hidden rather than unmounted, so the label fades as the rail narrows. */}
      <span className={cn("truncate transition-opacity", collapsed && "sr-only")}>
        {item.label}
      </span>
    </Button>
  );

  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">
        <p className="font-medium">{item.label}</p>
        <p className="text-xs opacity-80">{item.hint}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarContent({
  view,
  collapsed,
  onView,
}: {
  view: string;
  collapsed: boolean;
  onView: (value: string) => void;
}) {
  return (
    <TooltipProvider delayDuration={120}>
      <nav aria-label="Workspace navigation" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.heading}>
            {collapsed ? (
              <div aria-hidden="true" className="mx-auto mb-2 h-px w-6 bg-background/15" />
            ) : (
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-background/40">
                {group.heading}
              </p>
            )}
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavButton
                  key={item.value}
                  item={item}
                  active={view === item.value}
                  collapsed={collapsed}
                  onSelect={() => onView(item.value)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </TooltipProvider>
  );
}

export function AppShell({
  children,
  name = "Rescue partner",
  role,
  view,
  onView,
}: {
  children: ReactNode;
  name?: string;
  role?: string;
  view: string;
  onView: (view: string) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Restored after mount so the server and first client render agree.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "true");
    } catch {
      // Blocked storage just means the rail starts expanded.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(COLLAPSE_KEY, String(next));
      } catch {
        // Preference is a convenience; failing to persist changes nothing now.
      }
      return next;
    });
  }

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  }

  function selectView(value: string) {
    onView(value);
    setDrawerOpen(false);
  }

  const activeLabel =
    NAV_GROUPS.flatMap((g) => g.items).find((i) => i.value === view)?.label ?? "Workspace";

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop rail. Width is the only animated property, so the transition stays cheap. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col bg-foreground text-background transition-[width] duration-300 ease-out lg:flex",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        <div className={cn("flex h-16 items-center", collapsed ? "justify-center px-0" : "px-5")}>
          <Brand inverse compact={collapsed} />
        </div>
        <SidebarContent view={view} collapsed={collapsed} onView={selectView} />
        <div className={cn("border-t border-background/10 p-3", collapsed && "px-0")}>
          {!collapsed && (
            <p className="px-3 pb-3 text-xs leading-5 text-background/50">
              Central Iowa pilot
              <br />
              Food safety comes first.
            </p>
          )}
          <Button
            variant="ghost"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={cn(
              "h-10 w-full gap-3 text-background/65 hover:bg-background/10 hover:text-background",
              collapsed ? "justify-center px-0" : "justify-start px-3",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
            {!collapsed && <span className="text-sm">Collapse</span>}
          </Button>
        </div>
      </aside>

      {/* Mobile drawer: the same rail, slid in from the left over a scrim. */}
      <div
        aria-hidden={!drawerOpen}
        onClick={() => setDrawerOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-foreground/50 transition-opacity duration-300 lg:hidden",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        aria-label="Workspace navigation"
        aria-hidden={!drawerOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-foreground text-background transition-transform duration-300 ease-out lg:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Brand inverse />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="text-background/70 hover:bg-background/10 hover:text-background"
          >
            <X className="size-4" />
          </Button>
        </div>
        <SidebarContent view={view} collapsed={false} onView={selectView} />
      </aside>

      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-300 ease-out",
          collapsed ? "lg:pl-[72px]" : "lg:pl-64",
        )}
      >
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-8">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden"
          >
            <Menu className="size-5" />
          </Button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">{activeLabel}</h1>
              <ConnectionDot />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {VIEW_SUBTITLES[view] ?? "Des Moines rescue network"}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-10 gap-2 px-2" aria-label="Account menu">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                    {initials(name)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium sm:inline">{name.split(" ")[0]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="truncate font-semibold">{name}</p>
                <p className="mt-0.5 text-xs font-normal capitalize text-muted-foreground">
                  {role ? `${role} · Des Moines network` : "Des Moines rescue network"}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void signOut()}>
                <LogOut className="size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
