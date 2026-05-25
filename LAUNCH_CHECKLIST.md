# FOUND — App Store Launch Checklist

**Audit date:** 2026-05-25 · Supersedes the 2026-05-22 version.
**Method:** Live audit — web bundle compiled, live Supabase API probed directly (39 RPCs, 11 tables, 3 storage buckets), legal pages fetched, full code review. This is verified state, not a guess.

---

## Verdict

The app is **close but not submittable yet.** The core loop (auth → onboarding → discover → connect → message → groups) is built and the code is solid — the web bundle compiles clean with zero errors. But there are **6 hard blockers** between you and an App Store submission, and one of them (the database drift) means features are visibly broken *right now*.

Realistic timeline: **4–6 focused days** of work, not weeks. None of this is a rebuild.

**Before the meeting with Sam tomorrow:** run the SQL in Appendix A (2 minutes). It fixes 4 broken features and is the single highest-leverage thing you can do tonight.

---

## What I verified is WORKING

- Web bundle compiles cleanly — every screen, every import resolves, no syntax errors.
- Supabase: all 11 tables present, all 3 storage buckets present (`avatars`, `profile-photos`, `group-photos`), 35 of 39 RPCs live.
- Legal docs are **live and real** — `found.community/terms.html` (15 sections, dated 2026-05-21) and `privacy.html` (11 sections). Not placeholders.
- Git is clean and current (last commit today).
- Notifications system (in-app feed + push code) is built.
- Confirm dialogs are now in-app (`ConfirmProvider`) — the old `window.confirm` problem is fixed.

---

## P0 — HARD BLOCKERS (cannot submit without these)

### 1. Database drift — 4 RPCs missing from the live DB
Your Supabase DB was built by ad-hoc SQL patches, so 4 functions that exist in the migration files **never got applied**. Confirmed by probing the live API:

| Missing RPC | From migration | What's broken right now |
|---|---|---|
| `unread_inbound_count()` | 0012 | Activity tab badge — **always shows 0** |
| `unread_messages_count()` | 0015 | Messages tab badge — **always shows 0** |
| `dismiss_inbound(uuid)` | 0012 | "Dismiss" on Activity → throws an error popup |
| `mark_inbound_seen(uuid)` | 0012 | Activity unseen dots **never clear** |

- [ ] Run the SQL in **Appendix A** in the Supabase SQL editor. Idempotent, safe, ~2 minutes.

### 2. Block a user — Apple Guideline 1.2 (mandatory for any app with user-generated content)
The `block` value exists in the `connection_kind` enum but there is **no UI and no flow** anywhere. Apple rejects UGC apps without this on day one.
- [ ] "Block" action on profile detail, chat, and group member list
- [ ] Blocked users disappear for each other everywhere — Discover, Activity, Messages, Groups
- [ ] Verify `top_matches_detailed` and `inbound_connections` exclude blocked pairs

### 3. Report a user / content — Apple Guideline 1.2 (mandatory)
Nothing exists.
- [ ] "Report" action on profiles, messages, groups, and group posts
- [ ] A `reports` table so submissions land somewhere a human can review
- [ ] Apple wants reports actioned within 24h — have a plan, even if it's just an email alert

### 4. In-app account deletion — Apple Guideline 5.1.1(v) (mandatory)
No "Delete Account" anywhere in the app. **Also a legal problem:** your live Privacy Policy already promises users a deletion right the app can't currently deliver.
- [ ] "Delete My Account" in Profile → Settings
- [ ] `delete_account` RPC that cascades: profile, connections, group memberships, messages, photos rows, **and** storage files in all 3 buckets
- [ ] Confirmation step before it fires

### 5. EAS Build pipeline — you cannot produce an iOS binary without this
There is no `eas.json` and no `extra.eas.projectId` in `app.json`. With no EAS setup there is literally no iOS build to submit, and **push notifications stay dead** until a native build exists.
- [ ] `eas init` + `eas build:configure`
- [ ] First iOS build (`eas build -p ios`)
- [ ] Apple Developer account enrolled ($99/yr) — confirm this is done
- [ ] `eas submit` pipeline working

### 6. App Store Connect listing + privacy nutrition label
- [ ] Privacy "nutrition label" filled in (data collected: email, name, phone, location, photos, etc.)
- [ ] Screenshots (6.7" + 6.5" iPhone required), description, keywords, support URL, marketing URL
- [ ] Age rating questionnaire

---

## P1 — STRONGLY NEEDED (launch is risky without these)

- [ ] **Push notifications verified end-to-end** on a real device build — code is written but has never run on hardware. Test: new message, new connection request, group message.
- [ ] **Forgot / reset password** — there is no reset flow on the Sign In screen. Magic link is the only recovery path today. Add a proper "Reset password" link (`supabase.auth.resetPasswordForEmail`).
- [ ] **Search bar** — Sam's stated #1 priority, still not built. Search people by name/handle; ideally groups too.
- [ ] **Email confirmation decision** — decide whether Supabase email confirmation is enforced, and make sure the app handles the unconfirmed state cleanly. (Sign In already has copy for it — verify the setting matches.)
- [ ] **Test/junk data cleanup** — delete test groups (e.g. `rewf`), test profiles, and backfill geocoding for any real profiles with `NULL` location (`scripts/backfill-locations.js` exists for this).
- [ ] **Crash reporting** — Sentry. Without it you're blind to launch-day crashes.
- [ ] **Basic analytics** — PostHog or similar. You need to see where users drop off.
- [ ] **Version bump** — still `0.1.0` in both `package.json` and `app.json`. Ship `1.0.0`.
- [ ] **Empty states** — with near-zero users on day one, audit that Discover/Activity/Messages/Groups look intentional, not broken, when empty.

---

## P2 — POLISH / POST-LAUNCH (do not block on these)

- [ ] `ChurchDashboardScreen` exists but is not wired into navigation — wire it or delete it.
- [ ] `website/` folder is still committed inside the app repo — delete it (website has its own repo).
- [ ] `src/data/mock.js` — onboarding still pulls its question options from here. Functional, but the dead `MATCHES`/`GROUPS`/`MESSAGES` mock data should be removed; ideally move taxonomies to the DB tables that already exist (`life_stages`, `activities`, `community_goals`).
- [ ] Move geocoding off Nominatim (caps ~1 req/sec) to a cached Supabase Edge Function before real traffic.
- [ ] Image upload — add client-side compression + size cap before upload.
- [ ] Tighten `threads` insert RLS policy (`with check (true)` today — low risk, but tighten).
- [ ] Posting/activity feed, profile completion meter, reciprocal wave accept flow — backlog.

---

## Recommended execution order

1. **Tonight:** Appendix A SQL. 2 min. Fixes 4 broken features before Sam sees the app.
2. **Days 1–2:** Block + Report + Account Deletion (P0 #2, #3, #4). One migration, a `reports` table, a `delete_account` RPC, and the UI. These are the real Apple blockers and they share patterns.
3. **Day 3:** EAS setup, first iOS build, verify push on device (P0 #5, P1 push).
4. **Day 4:** Search bar + reset password + junk-data cleanup (P1).
5. **Day 5:** Sentry + analytics + empty states + version bump (P1).
6. **Day 6:** App Store Connect listing, screenshots, privacy label, submit (P0 #6).

---

## Appendix A — Database repair SQL

Paste this whole block into the Supabase SQL editor and run it once. It re-creates the 4 missing functions from migrations 0012 and 0015. Idempotent — safe to run anytime. The columns it depends on (`connections.seen_at/dismissed_at`, `messages.sender_id`, `thread_participants.last_read_at`) are confirmed present in your live DB.

```sql
-- ── FOUND DB repair: 4 RPCs missing from live DB (migrations 0012 + 0015) ──

-- 1. mark_inbound_seen(p_from) — clears Activity unseen dots
create or replace function public.mark_inbound_seen(p_from uuid default null)
returns void language sql security definer set search_path = public as $$
  update public.connections
  set seen_at = coalesce(seen_at, now())
  where to_profile = auth.uid()
    and (p_from is null or from_profile = p_from)
    and seen_at is null
    and kind in ('like','wave');
$$;
grant execute on function public.mark_inbound_seen(uuid) to authenticated;

-- 2. dismiss_inbound(p_from) — fixes the "Dismiss" button on Activity
create or replace function public.dismiss_inbound(p_from uuid)
returns void language sql security definer set search_path = public as $$
  update public.connections
  set dismissed_at = now()
  where to_profile = auth.uid()
    and from_profile = p_from
    and kind in ('like','wave');
$$;
grant execute on function public.dismiss_inbound(uuid) to authenticated;

-- 3. unread_inbound_count() — Activity tab badge
create or replace function public.unread_inbound_count()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.connections
  where to_profile = auth.uid()
    and kind in ('like','wave')
    and seen_at is null
    and dismissed_at is null;
$$;
grant execute on function public.unread_inbound_count() to authenticated;

-- 4. unread_messages_count() — Messages tab badge
create or replace function public.unread_messages_count()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.messages m
  join public.thread_participants tp
    on tp.thread_id  = m.thread_id
   and tp.profile_id = auth.uid()
  where m.sender_id <> auth.uid()
    and (tp.last_read_at is null or m.created_at > tp.last_read_at);
$$;
grant execute on function public.unread_messages_count() to authenticated;

-- Force PostgREST to pick up the new functions immediately
notify pgrst, 'reload schema';
```

**Verify after running:** in the app, the Activity and Messages tab badges should now reflect real counts, the Activity "Dismiss" button should work, and unseen dots should clear when you open the Activity tab.

---

## Audit caveats (honest scope)

- The app was **not visually clicked through.** The dev server runs in a sandbox with no browser bridge to it. What I did instead: compiled the full web bundle (catches every import/syntax error across all 40 screens/components) and probed the live Supabase backend API directly. To do a real interactive walkthrough, start `npx expo start --web` on your Mac and I can drive Chrome through it.
- Arg-taking RPCs were probed by signature, not executed with real auth — they are confirmed *registered*, not confirmed *bug-free* at runtime.
- Push notifications: code reviewed, never run on a device. Cannot be verified until an EAS build exists.
- Email-confirmation enforcement is a Supabase dashboard setting I can't read via the API — verify it manually.
