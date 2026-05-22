# FOUND — Launch Readiness Checklist

_Audit date: 2026-05-22. Based on static review of the app repo (no live run)._

**Verdict:** Not launchable yet. The core loop (auth → onboarding → discover → connect → message) is solid. But Groups is a half-feature, and three things will get the app **rejected from the App Store** on day one: no block/report, no in-app account deletion, no live legal docs. Plan on ~1–2 weeks of focused work.

---

## P0 — Hard blockers (cannot launch without these)

### 1. Groups — full stack (see detailed plan below)
- [ ] Fix `member_count` trigger bug
- [ ] Group Detail screen
- [ ] Group photos (bucket + upload + gallery)
- [ ] Group chat (end to end)
- [ ] Geocode groups on create
- [ ] Owner management (edit / delete / manage members)

### 2. Block & Report (App Store Guideline 1.2 — mandatory for UGC apps)
- [ ] Block a user (UI + flow) — `block` enum value exists, no UI
- [ ] Report a user / message / group
- [ ] Blocked users disappear from each other everywhere (Discover, Activity, Messages, Groups)
- [ ] Basic moderation: somewhere reports land that a human can review

### 3. In-app account deletion (Apple Guideline 5.1.1(v) — mandatory)
- [ ] "Delete my account" in Profile/Settings
- [ ] `delete_account` RPC that cascades (profile, connections, memberships, messages, photos, storage)

### 4. Legal
- [ ] Terms of Service — live, hosted URL (signup checkbox already links to it)
- [ ] Privacy Policy — live, hosted URL
- [ ] App Store privacy "nutrition label" filled in App Store Connect

### 5. Auth completeness
- [ ] Forgot / reset password flow (verify it exists — SignIn screen)
- [ ] Email verification: decide enforced vs not, and make the app handle the unverified state
- [ ] Magic link tested end to end

### 6. Search bar (Sam's #1 stated priority)
- [ ] Search people by name / handle
- [ ] Ideally search groups too

### 7. Push notifications
- [ ] Expo Notifications wired (token capture + permission prompt)
- [ ] Server trigger on: new message, new connection request, new group message
- [ ] Without this, retention dies in week one

### 8. Data cleanup
- [ ] Remove / quarantine `src/data/mock.js` and test profiles
- [ ] Backfill geocoding for any real seed profiles with NULL location
- [ ] Decide what the app looks like on day one with near-zero users (empty states must not look broken)

---

## P1 — Strongly needed (launch is risky without these)

- [ ] Crash reporting (Sentry)
- [ ] Basic analytics (PostHog or similar) — you need to see what users do
- [ ] Empty / error / offline states audited on every screen
- [ ] Image upload: size limit + client-side compression before upload
- [ ] Move geocoding off Nominatim to a cached Supabase Edge Function (Nominatim caps ~1 req/sec and will fail under launch traffic)
- [ ] EAS Build set up + store submission pipeline (bundle IDs already set: `com.found.community`)
- [ ] App Store + Play Store listings: screenshots, description, keywords
- [ ] Bump version from `0.1.0`
- [ ] Decide: is web (Vercel) part of launch, or app-only?
- [ ] Commit the 15 modified + untracked files currently sitting dirty in the repo
- [ ] Remove the stale `website/` folder from the app repo (website lives in its own repo now)

---

## P2 — Post-launch, do not block on these

- [ ] Posting / activity feed
- [ ] Profile completion meter / gamification
- [ ] Auto-generated group categories from search
- [ ] Reciprocal wave accept flow
- [ ] Distance chip on PersonCard
- [ ] Church B2B (Phase 2)

---

## GROUPS — Full-Stack Plan

### What already works
- DB: `groups`, `group_members`, `group_activities`, `photos` (polymorphic, supports `owner_kind='group'`), `threads` (supports `kind='group'`)
- RPCs: `my_groups_feed`, `join_group`, `leave_group`, `create_group`
- UI: Groups list, Create Group modal, join/leave with optimistic update + rollback
- RLS on every group table

### What's broken
1. **`member_count` is wrong after any join/leave by a non-owner.** The `bump_group_member_count` trigger is not `SECURITY DEFINER`, so its `UPDATE groups` is blocked by the `groups update own` RLS policy (which only allows owner/admin). A regular member joins → count silently does not increment. Owner sees the right number, everyone else sees stale counts on refresh.
2. **Tapping a group card does nothing** — `onPress={() => {}}`. No detail screen exists.
3. **`GroupCard` renders `group.category`** but `my_groups_feed` never returns it — always blank. Dead prop.
4. **`create_group` never sets `location`** — groups can never be sorted or filtered by distance. Same bug class profiles already hit. `my_groups_feed` also dumps *every* public group as "suggested" with no location/relevance ranking.

### What's missing for a legit, premium-feeling Groups feature
- **Group Detail screen**: cover photo, name, description, schedule, member count, member avatars + list, join/leave, photo gallery, "Open Group Chat" button, owner management entry.
- **Group photos**: `group-photos` storage bucket + RLS, a `groupPhotos` lib (mirror `profilePhotos.js`), RPCs to add/remove/list, gallery UI.
- **Group chat**: `open_group_thread(group_id)` RPC (find-or-create thread, add caller as participant), `ChatScreen` group mode (multiple senders → show name + avatar per message), and a message-RLS decision (see below).
- **Owner management**: edit group, delete group, remove member, promote admin, handle "owner leaves" (transfer or block).
- **Navigation**: register `GroupDetail` route; reuse `Chat` route for group threads.
- **Create modal**: add category/tags, cover photo, and a geocode call on submit.

### Open decision — group chat message permissions
`messages` insert/read RLS currently require `is_thread_participant`. Two options:
- **A:** Auto-insert every group member into `thread_participants` on join. Keeps per-user read receipts. More write paths to keep in sync.
- **B:** Widen `messages` RLS so group threads check `is_group_member(thread.group_id)`. Simpler, fewer rows. Loses per-user `last_read_at` unless tracked separately.
- **Recommendation: A** — you already have `last_read_at` on `thread_participants` and group unread badges will need it.

### Build order
1. **Migration `0018_groups_full`**: fix `member_count` trigger (`SECURITY DEFINER` + `search_path`); geocode in `create_group`; new RPCs (`group_detail`, `group_members_list`, `open_group_thread`, `add_group_photo` / `remove_group_photo` / `list_group_photos`); `group-photos` bucket + RLS; auto-add members as thread participants.
2. **`src/lib/groupPhotos.js`** — upload/delete helpers.
3. **`GroupDetailScreen`** — info + members + photo gallery + chat entry.
4. Wire `GroupCard onPress` → `GroupDetail`; register the route.
5. **Group chat** — `ChatScreen` group mode.
6. **Create modal** — category + cover photo + geocode.
7. **Owner management** — edit / delete / manage members.

---

## Security pass (do before launch)
- [ ] `threads insert` policy is `with check (true)` — anyone can insert any thread row. Low risk (messages/participants are gated) but tighten or move fully behind RPCs.
- [ ] Storage buckets are public-read — any photo URL is world-readable. Acceptable for a social app; just be aware.
- [ ] Confirm `.env` is gitignored (it is) and no keys are committed.
- [ ] Full RLS spot-check once Groups RPCs are added.
