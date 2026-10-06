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

## Real-Time Synchronization

RescueRelay features real-time synchronization backed by Supabase Realtime channels and TanStack Query:
- Instant live updates across operational tables (`donations`, `matches`, `deliveries`, `organizations`, `rescue_events`).
- Dual-channel reliability: WebSocket subscriptions push immediate changes, backed by fallback polling and automatic reconnection.
- Zero visual changes: preserves the authentic Lovable design system and layout.

