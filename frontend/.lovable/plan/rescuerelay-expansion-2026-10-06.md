# RescueRelay expansion

## Homepage
- Preserve the existing photography and branding; add focused sections for partners, food safety, explainable matching, and frequently asked questions.
- Add a clearly labeled pilot example showing 150 lb → 125 estimated meals, without presenting sample figures as real results.
- Add a footer with working section links and account access. Show dashboard access when already signed in.

## Accounts and operational dashboard
- Repair sign-in and confirmation redirects so returning partners reach their workspace without repeating onboarding.
- Make password recovery work after the email link establishes a recovery session, with clear loading and error states.
- Replace inactive sidebar links and dashboard controls with working navigation, rescue selection, partner information, and activity views.
- Derive totals, deadlines, delivery progress, and impact receipts from saved rescue records instead of hardcoded success figures.
- Ensure recipient actions target their organization’s matches and drivers act only on their assigned deliveries; coordinators retain authorized oversight.

## Live data and maps
- Reuse the existing Lovable Cloud backend and linked Google Maps connection; no second backend is needed.
- Refresh dashboard views when rescues, matches, deliveries, partner status, or activity change. Show actual connection status and a recovery option when updates fail.
- Render map markers from saved donation and recipient coordinates, with shared loading, cleanup, and useful empty/error states.
- Do not display invented road distances or travel times. Any route estimate will be labeled accurately.

## Technical details
- Preserve TanStack Start, the managed authenticated layout, server-side role checks, and deterministic Rescue Score.
- Tighten database workflow transitions against duplicate acceptances, route reassignment, invalid handoff order, and unauthorized recipient responses.
- Publish the needed tables to realtime and use the existing design-system controls.

## Verification
- Test homepage/footer links, account states, password recovery, dashboard interactions, and realtime updates wherever an authenticated test session is available.
- Run relevant tests and inspect preview errors. Report any email, Google sign-in, or map checks that require a user session or an authorized domain rather than claiming them verified.