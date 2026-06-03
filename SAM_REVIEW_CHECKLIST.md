# Sam Review Checklist — Build from 6-2-26

Run migration `0065_session_fixes.sql` in Supabase before testing.

---

## DB (Supabase SQL Editor)
- [ ] Run `supabase/migrations/0065_session_fixes.sql`
- [ ] Verify: `select looking_for_church from profiles limit 3;` — should return without error
- [ ] Verify: `select has_pending_invite from my_groups_feed() limit 3;`
- [ ] Verify: `select last_message_is_mine from my_threads_detailed() limit 3;`

---

## Profile / Match Detail

### In Common — Political matching
- [ ] Set your political lean to Conservative. Set Sam's to slightly conservative.
- [ ] Open Sam's profile → In Common should show "Similar political views"
- [ ] Set yours to Conservative, Sam's to Liberal → should NOT show political match
- [ ] Set either to Moderate (0) → should NOT show political match

### In Common — Hometown connector
- [ ] Both users set Miami in hometown cities
- [ ] Open match detail → should see a **peach banner** with location pin: "You're both from Miami"
- [ ] Try "Miami" vs "Miami, FL" — banner should still appear (normalized match)

---

## Edit Profile

### Political slider
- [ ] Open Edit Profile → "Political Views" section shows a **horizontal slider** (not chips)
- [ ] Drag slider left → shows "Liberal -X"
- [ ] Drag slider right → shows "Conservative +X"
- [ ] "Clear" button removes the selection
- [ ] Save → profile saves correctly, value persists on re-open

### Looking for a church toggle
- [ ] New "Looking for a Church?" section appears in Edit Profile
- [ ] Tap "Yes, looking" → highlights, saves on press Save
- [ ] Tap "Already have one" → highlights, saves on press Save
- [ ] Save → value persists on re-open

### Address field
- [ ] "Location" label is now **"Address"**
- [ ] Helper text: "By putting in your address you're helping us find people nearby..."
- [ ] Placeholder shows "City, State  or  ZIP code"

### Save fix
- [ ] Change name + life stage → hit Save → fields persist after reopening Edit Profile

---

## FOUND Tab (Activity Screen)

### Default view
- [ ] Tap FOUND tab → **Connected** view loads first (not Requests)

### Tab order
- [ ] Segment shows "Connected | Requests" (Connected on the left)

### Filter bar
- [ ] On Connected view, filter chips appear: All, Saved, + any life stage labels
- [ ] Tap a chip → list filters to matching connections

### Select mode
- [ ] Tap "Select" button → rows show checkboxes
- [ ] Tap connections → check/uncheck them
- [ ] Action bar at bottom shows "Message" and "Invite" buttons
- [ ] Tap "Cancel" → returns to normal mode

### Favorited / saved styling
- [ ] Bookmark / save a connection → row gets a **peach left stripe** and peach bookmark icon
- [ ] Unfavorite → stripe disappears

---

## Groups

### "+" button color
- [ ] Top right "+" button in Groups tab is **peach/clay** color (not black)

### Group invites
- [ ] Have Sam send a group invite to your account
- [ ] Open Groups tab → **"GROUP INVITES"** section appears at the top
- [ ] Tap "Accept" → join the group, invite row disappears, group appears in Joined

### Group invite accept in GroupDetail
- [ ] Navigate directly to an invited group (via notification or link)
- [ ] Should NOT crash
- [ ] Action bar shows **"Accept Invite"** button
- [ ] Tap Accept → joins the group

---

## Messages

### "You:" prefix
- [ ] Open Messages inbox → threads where YOU sent the last message show "You: [body]"
- [ ] Threads where they sent last message show raw body (no prefix)

### Bold names
- [ ] All direct (1:1) thread names should appear **bold**
- [ ] Group thread names are normal weight

---

## Navigation / Tab Bar

### "F." size
- [ ] FOUND tab icon "F." is visibly larger than before
- [ ] The tab label "FOUND" aligns with labels on other tabs

### Pill alignment
- [ ] Active tab pill visually centers under the icon on all tabs (Discover, FOUND, Messages, Groups, Profile)

### Dark app settings
- [ ] On Sam's phone (dark mode system setting), the app background should remain the same light cream color — not inverted

---

## Onboarding (new users only)

### Looking for a church step
- [ ] Complete onboarding as a new user
- [ ] New step appears: "Looking for a church?"
- [ ] Three options: Yes I'm looking / No I have one / Skip
- [ ] Selection saves to profile (`looking_for_church` column)

---

## Push Notifications
- [ ] Send Sam a message via TestFlight → Sam receives a **banner notification** on their lock screen
- [ ] Tap the notification → opens the correct chat thread in the app

---

## Known Limitations / Follow-up
- Bulk group message from Select mode → shows "Coming soon" toast (wires up later)
- Bulk event invite from Select mode → shows "Coming soon" toast (wires up later)
- Hometown normalization is client-side (Miami vs Miami FL matching) — if two users input the same city differently, may not match until they re-save their profile
