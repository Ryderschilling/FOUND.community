# FOUND — App QA Report

**Date:** May 22, 2026
**Build tested:** Web build, Expo dev server, `http://localhost:8081/`
**Account:** Ryder Schilling (logged in)
**Method:** Manual walkthrough of every tab + screen as a real user, plus console/network capture and source-code root-cause tracing against `found-app/src`.

---

## Verdict

The app is in solid shape structurally — every tab loads, navigation works, data renders, and the core loops (Discover → Connect, Profile edit, Groups, group chat) function. It does **not** currently operate like a finished premium app. There are **2 broken core features** and **4 things that look unprofessional on desktop/web**. None are hard crashes, but the New Message flow is fully dead and the Activity badge is silently broken. Fix the two P1s before anyone sees this. The P2s are what make it read as "demo" instead of "product."

One important caveat: most P2 issues are **web-only** (native phone behaves differently). If you're showing this off in a browser, fix them. If you're only showing it on a phone, they matter less.

---

## Bug summary

| # | Severity | Area | Issue | Web-only? |
|---|----------|------|-------|-----------|
| P1-1 | Critical | Messaging | "New Message" picker is dead — `messageable_contacts()` RPC missing from the live DB | No |
| P1-2 | Critical | Activity | Uncaught crash on tab focus — `mark_inbound_seen` never runs, unseen badge never clears | No |
| P2-1 | High | Match Detail | Highlight reel swallows vertical scroll — page feels frozen | Yes |
| P2-2 | High | Messaging | "New Message" sheet stretches the full browser width | Yes |
| P2-3 | High | App-wide | Native `window.confirm/alert` popups on every confirm action — blocking + off-brand | Yes |
| P2-4 | High | Discover | Location filter empties the whole app — profiles have no saved location | No |
| P3-1 | Low | Data | Junk test data is visible in-app (`rewf` group, gibberish text) | No |
| P3-2 | Low | Messaging | "No contacts yet" empty state masks the real backend error (see P1-1) | No |
| P3-3 | Low | Modals | Bottom-sheet drag handle steals the first tap from top form fields | Yes |
| P3-4 | Low | Code health | `confirmThen` helper copy-pasted across 4+ files | n/a |

---

## P1-1 — "New Message" picker is dead

**What happens:** Messages tab → compose (top-right) → modal always shows *"No contacts yet."* You cannot start a new 1:1 conversation with anyone, ever. The only reason messaging looks like it works is one pre-existing group thread.

**Root cause:** It is **not** an empty contact list. The backend RPC is failing. Console warning captured during the walkthrough:

```
[compose] contacts failed Could not find the function public.messageable_contacts without parameters in the schema cache
```

The client call is correct (`src/screens/MessagesScreen.js:240` → `supabase.rpc('messageable_contacts')`). The function is also correctly defined in `supabase/migrations/0011_geocode_and_messaging.sql`. **The function is just not in your live database** — migration 0011's `messageable_contacts()` either never applied or got dropped. The screen catches the error and falls back to an empty array, so it fails silently with a misleading message.

**Fix — run this in the Supabase SQL editor:**

```sql
-- Re-create messageable_contacts() (idempotent — safe to run anytime)
create or replace function public.messageable_contacts()
returns table (
  profile_id        uuid,
  full_name         text,
  handle            text,
  avatar_url        text,
  life_stage_label  text,
  city              text,
  state             text,
  is_match          boolean,
  last_touch        timestamptz
)
language sql stable
set search_path = public
as $$
  with me as (select auth.uid() as id),
  related as (
    select c.to_profile as other, max(c.created_at) as last_touch
    from public.connections c
    where c.from_profile = (select id from me)
      and c.kind in ('like','wave')
    group by c.to_profile
    union
    select c.from_profile as other, max(c.created_at)
    from public.connections c
    where c.to_profile = (select id from me)
      and c.kind in ('like','wave')
    group by c.from_profile
  ),
  collapsed as (
    select other, max(last_touch) as last_touch
    from related
    group by other
  )
  select
    p.id              as profile_id,
    p.full_name,
    p.handle::text    as handle,
    p.avatar_url,
    ls.label          as life_stage_label,
    p.city,
    p.state,
    (
      exists (select 1 from public.connections cn
              where cn.from_profile = (select id from me)
                and cn.to_profile = p.id and cn.kind = 'like')
      and
      exists (select 1 from public.connections cn
              where cn.from_profile = p.id
                and cn.to_profile = (select id from me) and cn.kind = 'like')
    ) as is_match,
    c.last_touch
  from collapsed c
  join public.profiles p on p.id = c.other
  left join public.life_stages ls on ls.id = p.life_stage_id
  order by is_match desc, c.last_touch desc;
$$;

grant execute on function public.messageable_contacts() to authenticated;

-- Force PostgREST to pick up the new function immediately
notify pgrst, 'reload schema';
```

**Verify:** In the SQL editor, run `select * from pg_proc where proname = 'messageable_contacts';` — you should get exactly one row. Then in the app, open Messages → compose. The picker should list people you've connected/waved with. Note: `auth.uid()` is NULL in the SQL editor, so don't expect rows when you call the function directly there — test it from the app.

**Watch for:** Since 0011 may have only partially applied, also confirm `set_profile_location()` exists (same migration) — that one is tied to P2-4. Run `select proname from pg_proc where proname in ('messageable_contacts','set_profile_location');` — you want **both** back.

---

## P1-2 — Activity tab throws an uncaught error on focus

**What happens:** Every time the Activity tab gains focus, an exception is thrown. Captured twice during the walkthrough:

```
TypeError: _libSupabase.supabase.rpc(...).catch is not a function
```

**Root cause:** `src/screens/ActivityScreen.js:197`

```js
supabase.rpc('mark_inbound_seen', { p_from: null }).catch(() => {});
```

`supabase.rpc(...)` returns a Postgrest query builder. It is *thenable* (has `.then()`) but it is **not a real Promise — it has no `.catch()`**. So `.catch()` throws a `TypeError` synchronously.

**Functional impact:** This isn't just console noise. The line throws before the RPC is sent, so `mark_inbound_seen` **never runs**. Result: the Activity tab's unseen dots and the tab badge count **never clear** after you view them. The badge will just keep climbing.

**Fix — `src/screens/ActivityScreen.js:197`:**

```js
// BEFORE
supabase.rpc('mark_inbound_seen', { p_from: null }).catch(() => {});

// AFTER
Promise.resolve(supabase.rpc('mark_inbound_seen', { p_from: null })).catch(() => {});
```

`Promise.resolve()` wraps the thenable into a real Promise, so `.catch()` exists and fire-and-forget still works.

**Verify:** Open the Activity tab with the console open. No more `catch is not a function`. Get an inbound request, view Activity, leave and return — the unseen dot and badge should clear.

**Note:** This is the only `.catch()` on a raw `rpc()`/`from()` call in the codebase — I grepped. So this one fix closes the whole class of error.

---

## P2-1 — Match Detail: highlight reel swallows scroll

**What happens:** On a profile detail page, if your cursor is over the photo reel (the center band of the screen) and you scroll, **nothing moves** — the page feels frozen. Scroll only works if the cursor happens to be over the header or the lower sections.

**Root cause:** The HIGHLIGHT REEL is a horizontal `ScrollView` nested inside the vertical page `ScrollView` (`src/screens/MatchDetailScreen.js`). On web, the horizontal scroller is ~262px tall and spans the full column — it occupies the visual center of the screen. It captures the vertical wheel event and does not pass it up to the parent. RN-web does not auto-forward cross-axis wheel deltas.

**Confirmed:** Content height 939px in a 645px viewport. Programmatic scroll works; wheeling over the header works (reaches the bottom fine); wheeling over the reel does nothing.

**Web-only:** On a real phone, RN locks touch direction so a vertical drag on a horizontal list passes through. This is a desktop/web bug only.

**Fix (recommended):** On web, intercept the wheel on the reel and forward vertical delta to the page. Add an `onWheel` handler to the reel's container so a mostly-vertical scroll bubbles up instead of being eaten. The minimal version: when `Math.abs(e.deltaY) > Math.abs(e.deltaX)`, let the event propagate (don't let the horizontal ScrollView consume it). If you'd rather not touch wheel plumbing, the cheap mitigation is to cap the reel's height so it occupies less of the viewport — but that doesn't fully fix it. I'd do the `onWheel` fix; tell me to and I'll write it.

**Secondary:** A profile with **zero** highlight photos still renders a 2578px-wide horizontal scroller of empty tiles. Render an empty-state placeholder instead of the scroller when `photos.length === 0` — cleaner, and it removes the scroll-swallowing element entirely for photo-less profiles.

---

## P2-2 — "New Message" sheet stretches the full browser width

**What happens:** The compose modal renders as a bottom sheet that spans the **entire 1470px browser window**, while the rest of the app is correctly boxed into a ~420px phone column. It looks broken on desktop. (The "Create a Group" sheet does *not* have this problem — it's properly boxed. Inconsistent.)

**Root cause:** `src/screens/MessagesScreen.js`, `modalStyles.sheet` (line ~322) has no width constraint. The RN `<Modal>` renders at the document root, outside the app's phone-column wrapper, so the sheet expands to the full backdrop width.

**Fix — `src/screens/MessagesScreen.js`, `modalStyles.sheet`:**

```js
// BEFORE
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
    maxHeight: '85%',
  },

// AFTER
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
    maxHeight: '85%',
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
```

**Verify:** Compose modal opens centered, phone-width, matching Create a Group.

---

## P2-3 — Native browser popups on every confirm action

**What happens:** Confirming anything — cancel a connection request, disconnect, leave a group — pops a raw `window.confirm()` / `window.alert()` browser dialog on web. It's grey, OS-styled, blocking, and completely off-brand. During testing one of these hard-froze the page until dismissed.

**Root cause:** `confirmThen()` uses `window.confirm` on web (the workaround for `Alert.alert` button callbacks not firing on RN-web). It's used in 7 screens/components: `PersonCard`, `MatchDetailScreen`, `GroupDetailScreen`, `GroupsScreen`, `ProfileScreen`, `OnboardingScreen`, `ActivityScreen`.

**Why it matters:** This is the single biggest "this is a demo, not a product" tell on web. A premium app never shows an OS confirm dialog.

**Fix:** Replace `confirmThen` with an in-app confirm modal — a small styled component (backdrop + card + Cancel/Confirm buttons) that matches the app's design, controlled by React state. Build it once, swap it in everywhere `confirmThen` is called. This is a ~1–2 hour job and a big visual upgrade. Say the word and I'll build the component and do the swaps in execution order.

---

## P2-4 — Location filter empties the entire app

**What happens:** Discover → location pill → "Near Me" or a city + radius → Discover goes **empty**. Looks badly broken.

**Root cause:** Not a logic bug — the filter and distance math are correct. The problem is **data**: your profile and Sam's profile (and most seed/test profiles) have a `NULL` PostGIS `location`. The `ST_DWithin` hard filter excludes every row with no location, so any location filter empties the list.

**Fix:** Two parts.
1. **Now:** Open Edit Profile for each real account, confirm city/state, hit Save. That triggers geocoding + `set_profile_location` and gives the row a real point. (Requires `set_profile_location()` to exist — see P1-1's verify step.)
2. **Before launch:** Backfill. Either re-save every seed profile, or run a one-time server-side script that geocodes `city/state → lat/lng` for all `location IS NULL` rows (rate-limited — Nominatim caps ~1 req/sec).

**Product call:** Until backfill is done, consider making the location filter a **soft sort** (rank nearer profiles higher) rather than a **hard filter** (drop everyone without a location). A hard filter that can empty the screen is a bad default. Soft-sort never produces an empty state.

---

## P3 — Polish & data hygiene

**P3-1 — Junk test data is visible in-app.** Groups tab shows a group literally named `rewf` with description `ewgvrtwvrtw` and a `Walkthrough Test Group`. The Messages inbox shows the `rewf` group thread. If anyone opens the app, they see this. Delete the test groups/threads before showing it off. (I did not delete anything — that's a destructive action; do it yourself or tell me to.)

**P3-2 — Misleading empty state.** "No contacts yet" is shown even when the cause is the failed RPC (P1-1). After fixing P1-1, also consider: in `ComposeModal`, track the `error` separately and show "Couldn't load contacts — try again" on error vs. "No contacts yet" on a genuine empty list. Right now a backend failure is indistinguishable from real emptiness.

**P3-3 — Drag handle steals taps.** On the bottom-sheet modals (New Message, Create a Group), the first tap near the top of the sheet hits the drag handle and repositions the sheet instead of focusing the field underneath. Minor friction. Either shrink the drag-handle hit area or disable drag-to-dismiss.

**P3-4 — `confirmThen` duplicated.** The helper is copy-pasted into 4+ files. When you do the P2-3 rewrite, make the new confirm component a single shared module and delete the duplicates. Not urgent, but do it as part of P2-3 rather than separately.

---

## What works well

Worth saying so you know where the floor is: auth/session persistence, the 3-state Connect button, Save/bookmark, the Activity inbound list, Profile + Edit Profile (scrolls fine, saves), Groups feed + Group Detail + group chat, the New Message *modal* logic itself, and tab navigation are all functioning. The visual design is consistent and on-brand. The bugs above are specific and fixable — this is a polish problem, not a rebuild.

---

## Could NOT fully test (caveats)

- **Sending messages** — did not send a real message (your inbox is live, your partner Sam is a real contact). The composer input and send button render and activate correctly; actual send/receive + realtime not verified.
- **Join/leave group, disconnect, dismiss** — did not trigger destructive mutations. The buttons render; the underlying RPCs were not exercised.
- **Push notifications** — not built yet (known backlog item), not tested.
- **Native iOS/Android** — tested on the **web build only**. P2-1, P2-2, P2-3, P3-3 are web-specific and likely behave differently (better) on a real device. Re-test on a phone before judging those.
- **Multi-account flows** — tested as one user. Match reciprocity, mutual-match transitions, and realtime between two accounts were not verified.

---

## Recommended fix order

1. **P1-1** — run the SQL block. ~5 min. Unblocks all of Messaging.
2. **P1-2** — one-line code fix in `ActivityScreen.js`. ~2 min.
3. **P2-4** — re-save real profiles + decide hard-filter vs soft-sort. ~15 min + a backfill task later.
4. **P2-2** — three lines in `modalStyles.sheet`. ~2 min.
5. **P3-1** — delete the junk test groups/threads. ~5 min.
6. **P2-3** — build the in-app confirm modal, swap out `confirmThen` everywhere (also closes P3-4). ~1–2 hrs. Biggest visual win.
7. **P2-1** — `onWheel` forwarding on the Match Detail reel + empty-reel placeholder. ~30–45 min.

Items 1, 2, 4, 5 are quick and high-leverage — do them in the next 20 minutes. Tell me which ones you want me to implement and I'll write the changes in execution order.
