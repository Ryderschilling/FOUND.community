# FOUND — Christian Community App

> Connecting local Christians — not just online, but in real life.

## Getting Started

```bash
cd found-app
npm install
npx expo start
```

Then press `i` for iOS simulator, `a` for Android, or scan the QR code with the Expo Go app on your phone.

## Project Structure

```
found-app/
├── App.js                        # Entry point
├── app.json                      # Expo config
├── src/
│   ├── theme/
│   │   └── index.js              # Colors, typography, shadows — edit here to change design
│   ├── data/
│   │   └── mock.js               # All mock data — replace with Supabase API calls
│   ├── components/
│   │   ├── PersonCard.js         # Match profile card
│   │   └── GroupCard.js          # Group listing card
│   ├── navigation/
│   │   └── index.js              # React Navigation setup (stack + bottom tabs)
│   └── screens/
│       ├── SplashScreen.js       # Logo + Get Started
│       ├── OnboardingScreen.js   # 4-step onboarding flow
│       ├── HomeScreen.js         # Discover / Match feed
│       ├── GroupsScreen.js       # Groups listing
│       ├── MessagesScreen.js     # Message threads
│       └── ProfileScreen.js      # User profile + settings
```

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React Native + Expo | Single codebase → iOS + Android |
| Routing | React Navigation | Stable, well-documented |
| Backend (next) | Supabase | Auth, Postgres, realtime, PostGIS geo queries |
| Payments (later) | Stripe | Church B2B subscriptions |
| Notifications (later) | Expo Notifications | APNs + FCM from one API |

## What's Built

- ✅ Splash screen
- ✅ 4-step onboarding (life stage → interests → church → match reveal)
- ✅ Discover screen with match cards, filter chips
- ✅ Groups screen with joined + suggested groups
- ✅ Messages inbox
- ✅ Profile screen with stats, interests, church, settings
- ✅ Full design system (warm cream / FOUND brand colors)

## What's Next (backend)

1. **Supabase setup** — auth (email + phone), user_profiles table, PostGIS for location
2. **Matching query** — filter by distance radius, score by shared attributes
3. **Connections** — POST /connections, show in messages
4. **Realtime messaging** — Supabase Realtime subscriptions
5. **Push notifications** — Expo Notifications + Supabase edge functions
6. **Church dashboard** — B2B admin view for churches

## Design System

All design tokens are in `src/theme/index.js`. Colors are based on the found.community website: warm cream backgrounds, clean white cards, near-black text, sage green accents.

---

Built with [Claude](https://claude.ai) · FOUND Community App v0.1
