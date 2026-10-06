# RescueRelay

> From surplus to supper — before it spoils.

RescueRelay is a coordinator-led real-time dispatch network for urgent food rescue, connecting food donors, verified recipient nonprofits, and volunteer drivers in minutes.

---

## Project Structure

```text
Rescue-Relay/
├── frontend/             # RescueRelay full-stack web application (TanStack Start, React 19, Tailwind CSS)
│   ├── src/
│   │   ├── routes/       # File-based routes (Landing, Auth, Onboarding, Dashboard)
│   │   ├── components/   # Rescuerelay design system, UI components, live map
│   │   ├── lib/          # Real-time synchronization (live-sync), scoring, server functions
│   │   └── integrations/ # Supabase client and auth middlewares
│   ├── drizzle/          # Database schemas & SQL migrations
│   └── package.json
├── package.json          # Monorepo root scripts
├── .gitignore
└── LICENSE
```

---

## Getting Started

### 1. Install Dependencies
From the repository root:
```bash
npm run dev
# or with bun:
cd frontend && bun install && bun run dev
```

### 2. Available Root Scripts
- `npm run dev` — Starts the frontend in development mode with HMR and real-time synchronization.
- `npm run build` — Builds the production bundle.
- `npm run preview` — Previews the production build locally.
- `npm run test` — Executes unit and integration test suites.

---

## Configuration

The app runs with **no API keys at all**. Everything below is optional hardening.

### Required once, in the Supabase dashboard

**Authentication → Sign In / Providers → uncheck "Confirm email".**

The project ships with `mailer_autoconfirm = false`. Until that box is unchecked, every
sign-up returns `email_not_confirmed` on the next sign-in, and the confirmation mail goes
through Supabase's built-in SMTP — owner address only, roughly two messages an hour. No
new donor, nonprofit, or driver can reach the workspace until this is changed or a real
SMTP provider is configured under **Authentication → Emails**.

Password reset and the resend-confirmation button on `/auth` depend on the same mail path.

### Optional environment variables

| Variable | Effect when absent |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Pickup geocoding falls back to the keyless providers below. Must be an **unrestricted server key** — a referer-restricted browser key is rejected by the Geocoding API. |
| `LOVABLE_API_KEY` | The Lovable connector gateway is skipped; set it together with `GOOGLE_MAPS_API_KEY` to route geocoding through Lovable. |
| `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY` | The dashboard map panel shows a configuration notice; all other views work. |

---

## Geocoding

Posting a donation needs coordinates before it can be scored against recipients, so
`createDonation` resolves the pickup address through a provider chain in
[`src/lib/geocode.server.ts`](frontend/src/lib/geocode.server.ts):

1. **Lovable connector gateway** — when `LOVABLE_API_KEY` and `GOOGLE_MAPS_API_KEY` are both set.
2. **Google Geocoding direct** — when an unrestricted `GOOGLE_MAPS_API_KEY` is set on its own.
3. **US Census geocoder** — keyless, public domain, US addresses only.
4. **Nominatim (OpenStreetMap)** — keyless, global; called with an identifying User-Agent and throttled to one request per 1.1s per the OSM usage policy.

Unconfigured providers are skipped rather than counted as failures, and a provider that
errors hands off to the next one, so a single outage never blocks a rescue. The chain
distinguishes the two failure modes the donor cares about: `AddressNotFoundError` when
providers answered but nothing matched (fix the address) and `GeocoderUnavailableError`
when every provider errored (retry shortly). The provider that placed the pin is recorded
on the `donation_posted` rescue event so coordinators can audit a bad location.

---

## Real-Time Synchronization

One shared Supabase Realtime channel per signed-in user watches all seven operational
tables (`donations`, `matches`, `deliveries`, `organizations`, `rescue_events`, `profiles`,
`user_roles`), each of which is in the `supabase_realtime` publication. Any saved change
refetches the single `rescue-workspace` query every authenticated view derives from.

Details that matter in the field, in [`src/lib/live-sync.tsx`](frontend/src/lib/live-sync.tsx):

- **The token is re-applied on refresh.** Realtime authorizes RLS against the token passed
  to `realtime.setAuth`, and that token rotates about an hour after sign-in. Without
  re-applying it the subscription keeps reporting `SUBSCRIBED` while silently delivering
  nothing, so `TOKEN_REFRESHED` re-authorizes the socket.
- **Invalidation is keyed.** Only `rescue-workspace` is refetched, and row events are
  debounced 150ms so one rescue action causes one refetch instead of a burst.
- **Reconnects back off with full jitter**, 1s to 15s, so a flapping socket cannot spin and
  many clients do not retry in lockstep after an outage.
- **Polling is the safety net, not the mechanism.** 60s while the socket is healthy, 5s
  while it is not.
- **The indicator tells the truth.** It reports the real channel state, the retry count, and
  how long since the last saved change — it does not read "Live" over a dead socket.

---

## Workspace views

All four derive from the same RLS-scoped workspace query, so nothing can drift out of sync
with the rescue records themselves. The derivations are pure functions with their own tests.

**Activity** ([`rescue-activity.ts`](frontend/src/lib/rescue-activity.ts)) splits a user's own
involvements into *current* and *recent*. Signing up to drive a route puts it under current;
confirming the delivery moves it to recent with the time it closed. The same applies to a
recipient's offers and a donor's postings. One rescue yields one entry, labelled with the
user's most hands-on role, and anything blocked on them floats to the top with a "Waiting on
you" badge and the action inline.

**Opportunities** ([`rescue-opportunities.ts`](frontend/src/lib/rescue-opportunities.ts)) lists
runs a volunteer can sign up for, nearest first when they share a location. Each one names the
food bank it serves — capacity, cold chain, households served, categories accepted — and driver
runs expand to a route map with distance and drive time. Routes render through the Maps JS
Directions service when the browser key authorizes; the distance/time estimate and the
"Open in Google Maps" / "Open in Apple Maps" links need no key at all, so a driver can always
start navigating.

**Partners** lists every verified food bank with the same detail, nearest first, and gives
coordinators verify/suspend controls inline.

Location is optional throughout: without it the lists still render, just ordered by deadline
rather than distance.

> **Migration 0010 must be applied** for Partners and Opportunities to show food banks a user
> is not already involved with. Migration 0009 scoped organization reads to rescues you are
> party to; 0010 re-opens *verified recipient* organizations only, leaving pending, suspended
> and donor organizations hidden.

---

## Verification

```bash
npm run test     # 55 tests: scoring, schemas, routing, geocoding, backoff,\n                 # activity lifecycle, opportunities, distance and routing
npm run build
npm run lint     # currently reports pre-existing Prettier formatting diffs in the
                 # generated dense-style files; `npm run format` would resolve them,
                 # at the cost of a repo-wide reformat that syncs back to Lovable.
```
