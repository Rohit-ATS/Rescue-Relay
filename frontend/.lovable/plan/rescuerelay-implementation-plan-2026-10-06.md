# RescueRelay implementation plan

## Goal
Build a polished, broader RescueRelay web app around the complete 150-pound Des Moines rescue scenario, while keeping the workflow reusable for additional donations, organizations, drivers, and deliveries.

## Product experience
- Create a distinctive, high-contrast operations interface that feels urgent, trustworthy, and civic rather than like a generic marketplace.
- Use a responsive desktop workspace for donors, recipients, and coordinators, plus a mobile-first driver experience.
- Make safety status, deadlines, handoffs, and the next action visually dominant.
- Seed realistic, clearly labeled demo data around the featured refrigerated-meals rescue.

## Accounts and access
- Enable Lovable Cloud and real email/password accounts with confirmation, password reset, and sign-out.
- Store profiles with name, organization, contact details, operational preferences, and onboarding status.
- Store donor, recipient, driver, and coordinator roles in a separate protected roles table; enforce permissions on the server and in database policies.
- Route each signed-in user to the correct workspace and give coordinators the authorized ability to verify organizations and handle exceptions.

## Core workflow
1. **Donor:** create a donation in under 60 seconds with category, pounds/servings, pickup address and deadline, storage condition, allergens, notes, and photo.
2. **Matching:** calculate an explainable Rescue Score from urgency, recipient capability/category fit, travel time, stated need, and driver capacity/availability. Block unsafe or incompatible matches.
3. **Recipient:** browse active opportunities on a live map/list, inspect the score explanation and safety details, then accept, decline, or reject as unsafe.
4. **Dispatch:** assign an eligible nearby trained driver; coordinators can review and resolve exceptions.
5. **Driver:** show pickup and delivery stops on a live route, then capture timestamps, proof photos, safety acknowledgements, and recipient confirmation/signature.
6. **Completion:** generate an impact receipt and update pounds rescued, estimated meals at the clearly labeled 1.2 lb-per-meal conversion, response time, completion rate, and landfill diversion.

## Main screens
- Public RescueRelay introduction with clear sign-in and pilot positioning.
- Authentication, registration, onboarding, and password recovery.
- Donor dashboard, create-donation flow, donation status, and impact receipt.
- Recipient opportunity board with live map/list, filters, match detail, and accept/decline controls.
- Driver assignment view with route, pickup/delivery checklist, and proof capture.
- Coordinator operations dashboard with live rescues, alerts, organization verification, assignments, audit trail, and impact reporting.
- Account/profile settings appropriate to each role.

## Live maps
- Connect Google Maps Platform using the managed Lovable connection.
- Render Des Moines-area markers and active rescue routes.
- Use authenticated, validated server calls for geocoding and route calculations, with bounded requests and clear unavailable/error states.
- Keep the core dispatch workflow usable if live route data is temporarily unavailable.

## Data and security
- Model organizations, profiles, user roles, donations, recipient matches, volunteers, deliveries, proofs, and status/audit events in Lovable Cloud.
- Add explicit grants, row-level security, storage rules, and server-side authorization so users see and change only permitted records.
- Validate every form in the browser and again on the server; constrain uploads and never expose private credentials.
- Persist demo rows through migrations so the judged scenario is always available.

## Demo polish and validation
- Make the featured flow land on: **150 lb rescued, 125 estimated meals, 38 minutes, 0 lb sent to landfill**.
- Include loading, empty, expired, unsafe, declined, and failure states without derailing the happy path.
- Add accessible labels, keyboard support, clear status language, and reduced-motion handling.
- Verify the full donor → recipient → driver → coordinator journey with real accounts on desktop and mobile, including live map behavior, permissions, uploads, and social metadata.

## Technical notes
- Keep the existing TanStack Start stack rather than the source plan’s suggested Next.js/Vercel stack.
- Use protected TanStack routes and authenticated server functions for private operations.
- Use a deterministic scoring module with tests so every score and explanation is auditable.
- Exclude payments, complex optimization, SMS, native apps, individual food distribution, and chatbot features.
