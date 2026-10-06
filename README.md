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

## Verification

```bash
npm run test     # 17 tests across scoring, schemas, routing, geocoding, backoff
npm run build
npm run lint     # currently reports pre-existing Prettier formatting diffs in the
                 # generated dense-style files; `npm run format` would resolve them,
                 # at the cost of a repo-wide reformat that syncs back to Lovable.
```
