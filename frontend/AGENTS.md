<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep private RescueRelay workflows under the managed authenticated route layout because browser sessions are unavailable during SSR.
- Put operational roles only in `user_roles`, never in profiles, because client-editable profile roles enable privilege escalation.
- Keep Rescue Score deterministic and explainable because dispatch decisions must be auditable by coordinators and recipients.
- Share session state through one root authentication context and subscriber so account links and recovery screens reflect the same session.
- Use a protected query-backed workspace with realtime invalidation across operational tables so every view derives from the same saved records.
- Load Google Maps through a shared promise and geocode pickup addresses only in authenticated server handlers so concurrent maps initialize safely and private keys stay server-side.
- Enforce rescue transitions in locked database functions and revoke direct workflow updates so concurrent or forged client requests cannot bypass authorization.
