# Contributing to FOUND.community

Short, opinionated guide. Read it once, follow it always.

## Branching

- `main` — production-shippable. Protected. Never push directly.
- `dev`  — integration branch. PRs against this.
- `feat/<short-name>` — feature branches, one PR per merge into `dev`.
- `fix/<short-name>` — bug fixes.

Tag releases on `main` as `v0.1.0`, `v0.2.0`...

## Pull requests

- Keep them small. One feature, one concern.
- Title format: `feat(area): short description` or `fix(area): ...`.
- Link the relevant work in description. If there's no issue, write 2 sentences on what + why.
- Require at least 1 approving review before merge.

## Code style

- Run `npx expo lint` before opening a PR (we'll add a CI job for this).
- No `console.log` left in committed code. Use `console.warn` for genuine warnings.
- Components live in `src/components/`. Screens in `src/screens/`. API calls in `src/api/`. No business logic in screens.

## Secrets

- Never commit `.env`. Use `.env.example` as the template.
- Supabase **service role key** stays out of the app entirely. Server-side scripts only.
- Stripe secret keys server-side only (we'll add a tiny Vercel/Netlify functions layer when we get to payments).

## Database changes

All schema changes go through `supabase/migrations/` as numbered SQL files:
- `0003_something.sql`, `0004_something.sql`, etc.
- Each migration is **idempotent** (`if not exists`, `on conflict do nothing`).
- Run the file in the Supabase SQL editor on dev first, then prod.
- Once Supabase CLI is wired (Phase 2), migrations will auto-run on deploy.

## Onboarding a new collaborator (e.g. Sam)

1. GitHub: Settings → Collaborators → add by username.
2. Supabase: Org members → invite by email.
3. Netlify: Team → add as member.
4. Share the `.env` values via 1Password / Bitwarden — **never** Slack/iMessage/email.
5. Walk them through `supabase/README.md` and `README.md`.
