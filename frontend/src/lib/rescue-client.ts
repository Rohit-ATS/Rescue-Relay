import { supabase } from '@/integrations/supabase/client';
import { scoreRescue } from '@/lib/rescue-scoring';
import { distanceMiles as haversineMiles } from '@/lib/geo';
import {
  DEMO_USER_ID,
  INITIAL_ORGANIZATIONS,
  INITIAL_PROFILES,
  INITIAL_ROLES,
  getInitialDonations,
  getInitialMatches,
  getInitialDeliveries,
  getInitialEvents,
  type WorkspaceData,
  type Donation,
  type Match,
  type Delivery,
  type RescueEvent,
  type Organization,
} from './demo-store';

const STORAGE_KEY = 'rescuerelay-demo-workspace-v1';
const REALTIME_CHANNEL = 'rescue-relay-live-stream';

function getStoredWorkspace(): WorkspaceData {
  if (typeof window === 'undefined') {
    return {
      profile: INITIAL_PROFILES[0],
      roles: INITIAL_ROLES,
      donations: getInitialDonations(),
      organizations: INITIAL_ORGANIZATIONS,
      matches: getInitialMatches(),
      deliveries: getInitialDeliveries(),
      events: getInitialEvents(),
      userId: DEMO_USER_ID,
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.donations) && parsed.donations.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[Demo Workspace] Failed to parse local workspace:', err);
  }

  const initial: WorkspaceData = {
    profile: INITIAL_PROFILES[0],
    roles: INITIAL_ROLES,
    donations: getInitialDonations(),
    organizations: INITIAL_ORGANIZATIONS,
    matches: getInitialMatches(),
    deliveries: getInitialDeliveries(),
    events: getInitialEvents(),
    userId: DEMO_USER_ID,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  } catch {}
  return initial;
}

function saveWorkspace(data: WorkspaceData) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // Broadcast state change across local tabs
    window.dispatchEvent(new CustomEvent('rescuerelay:workspace-updated'));
  } catch (err) {
    console.warn('[Demo Workspace] Failed to save workspace:', err);
  }
}

/**
 * Fetch workspace data with resilient fallback to rich demo data.
 * If Supabase tables contain rows, uses Supabase data.
 * Otherwise, uses the interactive local store that persists live actions.
 */
export async function fetchWorkspaceData(): Promise<WorkspaceData> {
  try {
    const [donationsRes, orgsRes, matchesRes, deliveriesRes, eventsRes] = await Promise.all([
      supabase.from('donations').select('*').order('pickup_deadline'),
      supabase.from('organizations').select('*').order('name'),
      supabase.from('matches').select('*').order('score', { ascending: false }),
      supabase.from('deliveries').select('*').order('created_at', { ascending: false }),
      supabase.from('rescue_events').select('*').order('created_at', { ascending: false }).limit(20),
    ]);

    if (donationsRes.data && donationsRes.data.length > 0) {
      return {
        profile: INITIAL_PROFILES[0],
        roles: INITIAL_ROLES,
        donations: donationsRes.data as Donation[],
        organizations: (orgsRes.data ?? INITIAL_ORGANIZATIONS) as Organization[],
        matches: (matchesRes.data ?? []) as Match[],
        deliveries: (deliveriesRes.data ?? []) as Delivery[],
        events: (eventsRes.data ?? []) as RescueEvent[],
        userId: DEMO_USER_ID,
      };
    }
  } catch (err) {
    console.warn('[Workspace] Remote query skipped or empty; using demo store:', err);
  }

  return getStoredWorkspace();
}

/**
 * Perform a rescue operation (accept, decline, unsafe, claim, pickup, deliver)
 * with instant client-side update and broadcast to all live tabs.
 */
export async function performRescueAction(
  id: string,
  action: 'accept' | 'decline' | 'unsafe' | 'claim' | 'pickup' | 'deliver',
): Promise<{ ok: boolean }> {
  const current = getStoredWorkspace();
  const now = new Date().toISOString();

  if (action === 'accept' || action === 'decline' || action === 'unsafe') {
    const match = current.matches.find((m) => m.id === id);
    if (match) {
      match.status = action === 'decline' ? 'declined' : (action as any);
      match.responded_at = now;
      match.responded_by = DEMO_USER_ID;

      const donation = current.donations.find((d) => d.id === match.donation_id);
      if (donation) {
        if (action === 'accept') {
          donation.status = 'accepted';
          // Ensure other matches are set or kept
          current.events.unshift({
            id: `evt-${Date.now()}`,
            donation_id: donation.id,
            actor_user_id: DEMO_USER_ID,
            event_type: 'recipient_accepted',
            detail: `Partner accepted rescue match (Score ${match.score})`,
            created_at: now,
          });
        } else if (action === 'unsafe') {
          current.events.unshift({
            id: `evt-${Date.now()}`,
            donation_id: donation.id,
            actor_user_id: DEMO_USER_ID,
            event_type: 'recipient_flagged_unsafe',
            detail: 'Partner flagged food as unsafe for intake',
            created_at: now,
          });
        }
      }
    }
  } else if (action === 'claim') {
    // id is match_id
    const match = current.matches.find((m) => m.id === id);
    if (match) {
      let delivery = current.deliveries.find((d) => d.match_id === id);
      if (!delivery) {
        delivery = {
          id: `del-${Date.now()}`,
          match_id: id,
          driver_user_id: DEMO_USER_ID,
          driver_name: 'Devon Marsh (Volunteer)',
          picked_up_at: null,
          delivered_at: null,
          recipient_confirmation: null,
          safety_acknowledged: false,
          created_at: now,
        };
        current.deliveries.push(delivery);
      } else {
        delivery.driver_user_id = DEMO_USER_ID;
        delivery.driver_name = 'Devon Marsh (Volunteer)';
      }
      const donation = current.donations.find((d) => d.id === match.donation_id);
      if (donation) {
        donation.status = 'driver_assigned';
        current.events.unshift({
          id: `evt-${Date.now()}`,
          donation_id: donation.id,
          actor_user_id: DEMO_USER_ID,
          event_type: 'driver_assigned',
          detail: 'Volunteer driver claimed route for delivery',
          created_at: now,
        });
      }
    }
  } else if (action === 'pickup') {
    // id is delivery_id
    const delivery = current.deliveries.find((d) => d.id === id);
    if (delivery) {
      delivery.picked_up_at = now;
      delivery.safety_acknowledged = true;
      const match = current.matches.find((m) => m.id === delivery.match_id);
      if (match) {
        const donation = current.donations.find((d) => d.id === match.donation_id);
        if (donation) {
          donation.status = 'picked_up';
          current.events.unshift({
            id: `evt-${Date.now()}`,
            donation_id: donation.id,
            actor_user_id: DEMO_USER_ID,
            event_type: 'picked_up',
            detail: 'Pickup confirmed at donor dock with temperature check',
            created_at: now,
          });
        }
      }
    }
  } else if (action === 'deliver') {
    // id is delivery_id
    const delivery = current.deliveries.find((d) => d.id === id);
    if (delivery) {
      delivery.delivered_at = now;
      delivery.recipient_confirmation = 'Received in safe condition';
      const match = current.matches.find((m) => m.id === delivery.match_id);
      if (match) {
        const donation = current.donations.find((d) => d.id === match.donation_id);
        if (donation) {
          donation.status = 'delivered';
          current.events.unshift({
            id: `evt-${Date.now()}`,
            donation_id: donation.id,
            actor_user_id: DEMO_USER_ID,
            event_type: 'delivered',
            detail: 'Delivery completed to community nonprofit recipient',
            created_at: now,
          });
        }
      }
    }
  }

  saveWorkspace(current);

  // Broadcast realtime message over Supabase channel
  try {
    const ch = supabase.channel(REALTIME_CHANNEL);
    await ch.send({
      type: 'broadcast',
      event: 'rescue_action',
      payload: { id, action, timestamp: Date.now() },
    });
  } catch {}

  return { ok: true };
}

/**
 * Verify a partner organization.
 */
export async function updatePartnerVerification(
  id: string,
  status: 'pending' | 'verified' | 'suspended',
): Promise<{ ok: boolean }> {
  const current = getStoredWorkspace();
  const org = current.organizations.find((o) => o.id === id);
  if (org) {
    org.verification_status = status;
    saveWorkspace(current);
  }
  return { ok: true };
}

/**
 * Create a new donation with instant matching and storage.
 */
export async function postNewDonation(data: {
  title: string;
  category: string;
  pounds: number;
  pickupAddress: string;
  pickupDeadline: string;
  storageRequired: string;
  allergens: string;
  notes: string;
}): Promise<{ id: string; matches: number }> {
  const current = getStoredWorkspace();
  const newId = `d1000000-0000-4000-a000-${Date.now().toString(16).padStart(12, '0')}`;
  const now = new Date().toISOString();

  // Coordinates default to downtown Des Moines for demo addresses
  const latitude = 41.5868 + (Math.random() - 0.5) * 0.04;
  const longitude = -93.625 + (Math.random() - 0.5) * 0.04;

  const newDonation: Donation = {
    id: newId,
    donor_user_id: DEMO_USER_ID,
    donor_org_id: 'd2000000-0000-4000-a000-000000000008',
    title: data.title,
    category: data.category,
    pounds: data.pounds,
    servings: Math.round(data.pounds / 1.2),
    pickup_address: data.pickupAddress,
    pickup_deadline: data.pickupDeadline,
    storage_required: data.storageRequired,
    allergens: data.allergens,
    notes: data.notes,
    latitude,
    longitude,
    status: 'open',
    photo_url: null,
    created_at: now,
  };

  current.donations.unshift(newDonation);

  // Compute matches
  const verifiedRecipients = current.organizations.filter(
    (o) => o.type === 'recipient' && o.verification_status === 'verified',
  );
  const deadlineMs = new Date(data.pickupDeadline).getTime();
  const candidates: Match[] = [];

  for (const r of verifiedRecipients) {
    const dist = Math.max(0.8, haversineMiles({ latitude: r.latitude, longitude: r.longitude }, { latitude, longitude }));
    const scored = scoreRescue({
      name: r.name,
      distanceMiles: dist,
      coldStorage: r.cold_storage,
      acceptsCategory: r.accepted_categories.includes(data.category),
      householdsServed: r.households_served,
      capacityLbs: r.capacity_lbs,
      requiredStorage: data.storageRequired,
      pounds: data.pounds,
      minutesRemaining: Math.max(0, (deadlineMs - Date.now()) / 60000),
    });

    if (scored.eligible) {
      candidates.push({
        id: `d3000000-0000-4000-a000-${(Date.now() + candidates.length).toString(16).padStart(12, '0')}`,
        donation_id: newId,
        recipient_org_id: r.id,
        score: scored.score,
        explanation: scored.explanation,
        status: 'proposed',
        responded_by: null,
        responded_at: null,
        created_at: now,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  current.matches.push(...candidates);

  current.events.unshift({
    id: `evt-${Date.now()}`,
    donation_id: newId,
    actor_user_id: DEMO_USER_ID,
    event_type: 'donation_posted',
    detail: `${data.pounds} lb ${data.category} posted · ${candidates.length} recipient partner(s) matched`,
    created_at: now,
  });

  saveWorkspace(current);

  return { id: newId, matches: candidates.length };
}

/** Reset demo data to fresh seed state anytime. */
export function resetDemoWorkspace(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  getStoredWorkspace();
  window.dispatchEvent(new CustomEvent('rescuerelay:workspace-updated'));
}
